-- Contacts: one address book of everyone the store can reach — imported old
-- customers (Shopify, Klaviyo…), early-access sign-ups, restock requests and
-- paying customers — with no person ever listed twice.
--
-- How "never twice" is enforced:
--   * Every email and phone number a contact has is also a row in
--     contact_keys, whose primary key is the normalised identifier. The
--     database itself therefore refuses a second contact with the same email
--     or number, whichever way it's written (+61 412…, 0412…, '61412…).
--   * import_contacts() merges instead of inserting: a row matching an existing
--     contact (by any email/number, or by the same full name) fills in that
--     contact's blanks, and a row that links two existing contacts folds them
--     into one.
--   * Sign-ups, restock requests and paid orders are merged in automatically
--     by triggers, so the list stays complete and duplicate-free by itself.
--
-- Personal data: readable and writable only by signed-in dashboard users.

-- ---------------------------------------------------------------------------
-- Normalisation (kept in step with src/lib/contacts.ts)
-- ---------------------------------------------------------------------------

-- Phone numbers to international form. Bare Australian numbers (0412…,
-- 412…) get +61; "+61 0412…" loses the stray trunk 0. Null when there's no
-- real number in it.
CREATE OR REPLACE FUNCTION public.contact_phone_key(raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  d text;
  k text;
BEGIN
  d := regexp_replace(coalesce(raw, ''), '[^0-9+]', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;
  d := left(d, 1) || replace(substr(d, 2), '+', '');
  IF d !~ '[0-9]{6,}' THEN RETURN NULL; END IF;
  IF left(d, 1) = '+' THEN k := d;
  ELSIF left(d, 2) = '00' THEN k := '+' || substr(d, 3);
  ELSIF d ~ '^0[2-478][0-9]{8}$' THEN k := '+61' || substr(d, 2);
  ELSIF d ~ '^4[0-9]{8}$' THEN k := '+61' || d;
  ELSE k := '+' || d;
  END IF;
  IF k ~ '^\+610[0-9]{9}$' THEN k := '+61' || substr(k, 5); END IF;
  RETURN k;
END $$;

-- Emails lowercased, with mistyped mail domains corrected (mail to
-- "gnail.com" can never arrive). Null when it isn't an email address.
CREATE OR REPLACE FUNCTION public.contact_email_key(raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v text;
  dom text;
BEGIN
  v := lower(btrim(coalesce(raw, '')));
  IF v !~ '^[^@[:space:],;]+@[^@[:space:],;]+\.[a-z]{2,}$' THEN RETURN NULL; END IF;
  dom := split_part(v, '@', 2);
  dom := CASE dom
    WHEN 'gnail.com' THEN 'gmail.com'   WHEN 'gmial.com' THEN 'gmail.com'
    WHEN 'gmai.com' THEN 'gmail.com'    WHEN 'gamil.com' THEN 'gmail.com'
    WHEN 'gmail.con' THEN 'gmail.com'   WHEN 'gmail.cm' THEN 'gmail.com'
    WHEN 'hotmial.com' THEN 'hotmail.com' WHEN 'hotmail.con' THEN 'hotmail.com'
    WHEN 'yahoo.con' THEN 'yahoo.com'   WHEN 'icloud.con' THEN 'icloud.com'
    WHEN 'outlook.con' THEN 'outlook.com'
    ELSE dom END;
  RETURN split_part(v, '@', 1) || '@' || dom;
END $$;

-- Names compared ignoring case, spacing and curly vs straight apostrophes.
CREATE OR REPLACE FUNCTION public.contact_name_key(raw text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT nullif(lower(regexp_replace(translate(btrim(coalesce(raw, '')), '’‘`´', ''''''''''),
                                     '\s+', ' ', 'g')), '')
$$;

-- Could two names be the same person? Same first name and a matching
-- surname, ignoring middle names/initials and a dropped letter at the end
-- ("Sam Taylor" ~ "Sam J Taylor", "Lee Jone" ~ "Lee Jones").
-- A missing name is compatible with anything.
CREATE OR REPLACE FUNCTION public.contact_names_compatible(a text, b text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH n AS (SELECT public.contact_name_key(a) AS a, public.contact_name_key(b) AS b),
       t AS (SELECT a, b, split_part(a, ' ', 1) AS fa, split_part(b, ' ', 1) AS fb,
                    substring(a FROM '[^ ]+$') AS la, substring(b FROM '[^ ]+$') AS lb FROM n)
  SELECT CASE
    WHEN a IS NULL OR b IS NULL OR a = b THEN true
    WHEN fa <> fb THEN false
    WHEN position(' ' IN a) = 0 OR position(' ' IN b) = 0 THEN true
    ELSE left(la, length(lb)) = lb OR left(lb, length(la)) = la
  END FROM t
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  email text,                                 -- main email (normalised)
  phone text,                                 -- main number (international form)
  other_emails text[] NOT NULL DEFAULT '{}',  -- any further addresses for the same person
  other_phones text[] NOT NULL DEFAULT '{}',
  address text,
  city text,
  state text,
  postcode text,
  country text,
  location text,                              -- free-text place when there's no address
  email_consent boolean,                      -- agreed to marketing email (null = unknown)
  sms_consent boolean,                        -- agreed to marketing texts (null = unknown)
  shopify_orders integer,                     -- history from the old Shopify store
  shopify_spent numeric,
  tags text,
  note text,
  sources text[] NOT NULL DEFAULT '{}',       -- where we know them from
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contact_keys (
  key text PRIMARY KEY,                       -- 'e:<email>' or 'p:<phone>'
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS contact_keys_contact_id ON public.contact_keys (contact_id);
CREATE INDEX IF NOT EXISTS contacts_name_key ON public.contacts (public.contact_name_key(name));

-- Keep every stored identifier normalised and de-duplicated within the row.
CREATE OR REPLACE FUNCTION public.contacts_normalise()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.email := public.contact_email_key(NEW.email);
  NEW.phone := public.contact_phone_key(NEW.phone);
  NEW.other_emails := coalesce((
    SELECT array_agg(DISTINCT k) FROM unnest(NEW.other_emails) e, LATERAL public.contact_email_key(e) k
    WHERE k IS NOT NULL AND k IS DISTINCT FROM NEW.email), '{}');
  NEW.other_phones := coalesce((
    SELECT array_agg(DISTINCT k) FROM unnest(NEW.other_phones) p, LATERAL public.contact_phone_key(p) k
    WHERE k IS NOT NULL AND k IS DISTINCT FROM NEW.phone), '{}');
  -- A contact always has a main email/number when it has any.
  IF NEW.email IS NULL AND cardinality(NEW.other_emails) > 0 THEN
    NEW.email := NEW.other_emails[1];
    NEW.other_emails := NEW.other_emails[2:];
  END IF;
  IF NEW.phone IS NULL AND cardinality(NEW.other_phones) > 0 THEN
    NEW.phone := NEW.other_phones[1];
    NEW.other_phones := NEW.other_phones[2:];
  END IF;
  NEW.name := nullif(btrim(regexp_replace(coalesce(NEW.name, ''), '\s+', ' ', 'g')), '');
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS contacts_normalise ON public.contacts;
CREATE TRIGGER contacts_normalise BEFORE INSERT OR UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_normalise();

-- Mirror every identifier into contact_keys. An identifier that already
-- belongs to another contact makes the write fail: that's the duplicate guard.
CREATE OR REPLACE FUNCTION public.contacts_sync_keys()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.contact_keys WHERE contact_id = NEW.id;
  INSERT INTO public.contact_keys (key, contact_id)
  SELECT DISTINCT k, NEW.id FROM (
    SELECT 'e:' || e AS k FROM unnest(array_prepend(NEW.email, NEW.other_emails)) e WHERE e IS NOT NULL
    UNION ALL
    SELECT 'p:' || p FROM unnest(array_prepend(NEW.phone, NEW.other_phones)) p WHERE p IS NOT NULL
  ) ids;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS contacts_sync_keys ON public.contacts;
CREATE TRIGGER contacts_sync_keys AFTER INSERT OR UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_sync_keys();

-- ---------------------------------------------------------------------------
-- Merge one person in
-- ---------------------------------------------------------------------------

-- Values from a JSON field that may be a list or a "a; b" string.
CREATE OR REPLACE FUNCTION public.contact_list(v jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(array_agg(btrim(x)) FILTER (WHERE btrim(x) <> ''), '{}')
  FROM (
    SELECT jsonb_array_elements_text(v) AS x WHERE jsonb_typeof(v) = 'array'
    UNION ALL
    SELECT regexp_split_to_table(v #>> '{}', '[;,]') WHERE jsonb_typeof(v) = 'string'
  ) s
$$;

-- A number from loosely formatted text ("$1,204.50" → 1204.50); null if none.
CREATE OR REPLACE FUNCTION public.contact_num(v text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN regexp_replace(coalesce(v, ''), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN regexp_replace(v, '[^0-9.-]', '', 'g')::numeric END
$$;

CREATE OR REPLACE FUNCTION public.contact_bool(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN jsonb_typeof(v) = 'boolean' THEN (v #>> '{}')::boolean
    WHEN lower(btrim(v #>> '{}')) IN ('yes', 'true', 'y', '1', 'subscribed') THEN true
    WHEN lower(btrim(v #>> '{}')) IN ('no', 'false', 'n', '0', 'unsubscribed') THEN false
    ELSE NULL END
$$;

-- Fold contact `other` into `target` (they're the same person): target keeps
-- its own details and gains the other's emails, numbers and anything it lacks.
CREATE OR REPLACE FUNCTION public.contact_fold(target uuid, other uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.contacts;
BEGIN
  DELETE FROM public.contacts WHERE id = other RETURNING * INTO o;
  IF o.id IS NULL THEN RETURN; END IF;
  UPDATE public.contacts c SET
    name = coalesce(c.name, o.name),
    other_emails = c.other_emails || array_prepend(o.email, o.other_emails),
    other_phones = c.other_phones || array_prepend(o.phone, o.other_phones),
    address = coalesce(c.address, o.address), city = coalesce(c.city, o.city),
    state = coalesce(c.state, o.state), postcode = coalesce(c.postcode, o.postcode),
    country = coalesce(c.country, o.country), location = coalesce(c.location, o.location),
    email_consent = coalesce(c.email_consent, o.email_consent),
    sms_consent = coalesce(c.sms_consent, o.sms_consent),
    shopify_orders = greatest(c.shopify_orders, o.shopify_orders),
    shopify_spent = greatest(c.shopify_spent, o.shopify_spent),
    tags = coalesce(c.tags, o.tags), note = coalesce(c.note, o.note),
    sources = ARRAY(SELECT DISTINCT s FROM unnest(c.sources || o.sources) s ORDER BY s),
    created_at = least(c.created_at, o.created_at)
  WHERE c.id = target;
END $$;

-- Add one person (an object with name, email, phone, other_emails,
-- other_phones, address, city, state, postcode, country, location,
-- email_consent, sms_consent, orders, spent, tags, note, sources), merging
-- into whoever they already are. Returns what happened: 'added', 'updated',
-- 'merged' (it joined up two existing contacts), 'unchanged' or 'skipped'
-- (no email or number to go on).
CREATE OR REPLACE FUNCTION public.merge_contact(p jsonb, p_source text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_emails text[];
  v_phones text[];
  v_keys text[];
  v_name text := nullif(btrim(p ->> 'name'), '');
  v_sources text[];
  v_ids uuid[];
  v_named uuid[];
  v_target uuid;
  v_target_name text;
  v_other public.contacts;
  v_before public.contacts;
  v_after public.contacts;
  v_result text;
BEGIN
  SELECT coalesce(array_agg(DISTINCT k) FILTER (WHERE k IS NOT NULL), '{}') INTO v_emails
  FROM unnest(array_prepend(p ->> 'email', public.contact_list(p -> 'other_emails'))) e,
       LATERAL public.contact_email_key(e) k;
  SELECT coalesce(array_agg(DISTINCT k) FILTER (WHERE k IS NOT NULL), '{}') INTO v_phones
  FROM unnest(array_prepend(p ->> 'phone', public.contact_list(p -> 'other_phones'))) ph,
       LATERAL public.contact_phone_key(ph) k;
  -- keep the row's own main email/number first
  IF public.contact_email_key(p ->> 'email') IS NOT NULL THEN
    v_emails := array_prepend(public.contact_email_key(p ->> 'email'),
                              array_remove(v_emails, public.contact_email_key(p ->> 'email')));
  END IF;
  IF public.contact_phone_key(p ->> 'phone') IS NOT NULL THEN
    v_phones := array_prepend(public.contact_phone_key(p ->> 'phone'),
                              array_remove(v_phones, public.contact_phone_key(p ->> 'phone')));
  END IF;
  IF cardinality(v_emails) = 0 AND cardinality(v_phones) = 0 THEN
    RETURN 'skipped';
  END IF;

  SELECT array_agg(e) INTO v_keys FROM (
    SELECT 'e:' || x AS e FROM unnest(v_emails) x UNION ALL SELECT 'p:' || x FROM unnest(v_phones) x
  ) s;
  v_sources := ARRAY(SELECT DISTINCT s FROM unnest(public.contact_list(p -> 'sources') || p_source) s
                     WHERE s IS NOT NULL AND s <> '' ORDER BY s);

  -- Who are they already? Everyone sharing an email or number...
  SELECT array_agg(c.id) INTO v_ids
  FROM public.contacts c
  WHERE c.id IN (SELECT contact_id FROM public.contact_keys WHERE key = ANY (v_keys));
  -- ...plus the one other contact with the same full name. The name only
  -- counts when it agrees with whoever the email/number already belongs to:
  -- a list pairing a name with someone else's number mustn't join two people.
  IF v_name LIKE '% %' AND NOT EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = ANY (coalesce(v_ids, '{}')) AND NOT public.contact_names_compatible(c.name, v_name)
  ) THEN
    v_named := ARRAY(SELECT c.id FROM public.contacts c
                     WHERE public.contact_name_key(c.name) = public.contact_name_key(v_name)
                       AND c.id <> ALL (coalesce(v_ids, '{}')));
    IF cardinality(v_named) = 1 THEN v_ids := coalesce(v_ids, '{}') || v_named; END IF;
  END IF;
  -- the longest-standing contact is the one that stays
  IF v_ids IS NOT NULL THEN
    SELECT array_agg(c.id ORDER BY c.created_at, c.id) INTO v_ids FROM public.contacts c WHERE c.id = ANY (v_ids);
  END IF;

  IF v_ids IS NULL THEN
    INSERT INTO public.contacts (name, email, phone, other_emails, other_phones, address, city, state,
      postcode, country, location, email_consent, sms_consent, shopify_orders, shopify_spent, tags, note, sources)
    VALUES (v_name, v_emails[1], v_phones[1], coalesce(v_emails[2:], '{}'), coalesce(v_phones[2:], '{}'),
      nullif(btrim(p ->> 'address'), ''), nullif(btrim(p ->> 'city'), ''), nullif(btrim(p ->> 'state'), ''),
      nullif(btrim(p ->> 'postcode'), ''), nullif(btrim(p ->> 'country'), ''), nullif(btrim(p ->> 'location'), ''),
      public.contact_bool(p -> 'email_consent'), public.contact_bool(p -> 'sms_consent'),
      round(public.contact_num(p ->> 'orders'))::integer, public.contact_num(p ->> 'spent'),
      nullif(btrim(p ->> 'tags'), ''), nullif(btrim(p ->> 'note'), ''), v_sources);
    RETURN 'added';
  END IF;

  -- The contact that stays: the one with this row's name if exactly one has
  -- it, otherwise the longest-standing.
  v_target := v_ids[1];
  IF cardinality(v_ids) > 1 AND v_name IS NOT NULL THEN
    v_named := ARRAY(SELECT c.id FROM public.contacts c WHERE c.id = ANY (v_ids)
                     AND public.contact_name_key(c.name) = public.contact_name_key(v_name));
    IF cardinality(v_named) = 1 THEN v_target := v_named[1]; END IF;
  END IF;
  SELECT name INTO v_target_name FROM public.contacts WHERE id = v_target;
  v_result := 'updated';

  -- The row joins up several contacts.
  FOR i IN 1 .. cardinality(v_ids) LOOP
    CONTINUE WHEN v_ids[i] = v_target;
    SELECT * INTO v_other FROM public.contacts WHERE id = v_ids[i];
    IF NOT public.contact_names_compatible(v_other.name, v_target_name)
       AND public.contact_name_key(v_target_name) = public.contact_name_key(v_name) THEN
      -- A differently-named person holds one of this person's details
      -- (e.g. a list that paired a name with the wrong number): hand the
      -- detail over and leave them otherwise as they are.
      UPDATE public.contacts c SET
        email = CASE WHEN c.email = ANY (v_emails) THEN NULL ELSE c.email END,
        other_emails = ARRAY(SELECT e FROM unnest(c.other_emails) e WHERE e <> ALL (v_emails)),
        phone = CASE WHEN c.phone = ANY (v_phones) THEN NULL ELSE c.phone END,
        other_phones = ARRAY(SELECT x FROM unnest(c.other_phones) x WHERE x <> ALL (v_phones))
      WHERE c.id = v_other.id
      RETURNING * INTO v_other;
      IF v_other.email IS NULL AND v_other.phone IS NULL THEN
        PERFORM public.contact_fold(v_target, v_other.id);  -- nothing left of them: same person after all
      END IF;
    ELSE
      PERFORM public.contact_fold(v_target, v_other.id);    -- they're one person
    END IF;
    v_result := 'merged';
  END LOOP;

  SELECT * INTO v_before FROM public.contacts WHERE id = v_target;
  UPDATE public.contacts c SET
    name = coalesce(c.name, v_name),
    other_emails = c.other_emails || v_emails,
    other_phones = c.other_phones || v_phones,
    address = coalesce(c.address, nullif(btrim(p ->> 'address'), '')),
    city = coalesce(c.city, nullif(btrim(p ->> 'city'), '')),
    state = coalesce(c.state, nullif(btrim(p ->> 'state'), '')),
    postcode = coalesce(c.postcode, nullif(btrim(p ->> 'postcode'), '')),
    country = coalesce(c.country, nullif(btrim(p ->> 'country'), '')),
    location = coalesce(c.location, nullif(btrim(p ->> 'location'), '')),
    email_consent = coalesce(c.email_consent, public.contact_bool(p -> 'email_consent')),
    sms_consent = coalesce(c.sms_consent, public.contact_bool(p -> 'sms_consent')),
    shopify_orders = greatest(c.shopify_orders, round(public.contact_num(p ->> 'orders'))::integer),
    shopify_spent = greatest(c.shopify_spent, public.contact_num(p ->> 'spent')),
    tags = coalesce(c.tags, nullif(btrim(p ->> 'tags'), '')),
    note = coalesce(c.note, nullif(btrim(p ->> 'note'), '')),
    sources = ARRAY(SELECT DISTINCT s FROM unnest(c.sources || v_sources) s ORDER BY s)
  WHERE c.id = v_target
  RETURNING * INTO v_after;

  -- Only real details count as an update; noting one more source doesn't.
  IF v_result = 'updated'
     AND (v_before.name, v_before.email, v_before.phone, v_before.other_emails, v_before.other_phones,
          v_before.address, v_before.city, v_before.state, v_before.postcode, v_before.country, v_before.location,
          v_before.email_consent, v_before.sms_consent, v_before.shopify_orders, v_before.shopify_spent,
          v_before.tags, v_before.note)
     IS NOT DISTINCT FROM
         (v_after.name, v_after.email, v_after.phone, v_after.other_emails, v_after.other_phones,
          v_after.address, v_after.city, v_after.state, v_after.postcode, v_after.country, v_after.location,
          v_after.email_consent, v_after.sms_consent, v_after.shopify_orders, v_after.shopify_spent,
          v_after.tags, v_after.note) THEN
    v_result := 'unchanged';
  END IF;
  RETURN v_result;
END $$;

-- Merge a whole list (a JSON array of people, as for merge_contact) in one
-- go and report how it went: {"added": n, "updated": n, "merged": n,
-- "unchanged": n, "skipped": n}.
CREATE OR REPLACE FUNCTION public.import_contacts(people jsonb, source text DEFAULT 'import')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r jsonb;
  outcome text;
  tally jsonb := '{"added":0,"updated":0,"merged":0,"unchanged":0,"skipped":0}';
BEGIN
  IF jsonb_typeof(people) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'import_contacts expects a JSON array of people';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(people) LOOP
    outcome := public.merge_contact(r, source);
    tally := jsonb_set(tally, ARRAY[outcome], to_jsonb((tally ->> outcome)::int + 1));
  END LOOP;
  RETURN tally;
END $$;

-- ---------------------------------------------------------------------------
-- Keep the list complete automatically
-- ---------------------------------------------------------------------------

-- Never let a contacts problem block a sign-up or an order: log and carry on.
CREATE OR REPLACE FUNCTION public.contacts_capture()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'phone_signups' THEN
      PERFORM public.merge_contact(jsonb_build_object('phone', NEW.phone), 'early access');
    ELSIF TG_TABLE_NAME = 'restock_reminders' THEN
      PERFORM public.merge_contact(jsonb_build_object('phone', NEW.phone), 'restock request');
    ELSIF TG_TABLE_NAME = 'orders' AND NEW.status IN ('paid', 'fulfilled') THEN
      PERFORM public.merge_contact(jsonb_strip_nulls(jsonb_build_object(
        'name', NEW.customer_name, 'email', NEW.customer_email, 'phone', NEW.customer_phone,
        'address', NEW.shipping_address, 'city', NEW.shipping_city, 'state', NEW.shipping_state,
        'postcode', NEW.shipping_postcode, 'country', NEW.shipping_country)), 'order');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'contacts: could not record % %: %', TG_TABLE_NAME, NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS contacts_capture ON public.phone_signups;
CREATE TRIGGER contacts_capture AFTER INSERT ON public.phone_signups
  FOR EACH ROW EXECUTE FUNCTION public.contacts_capture();
DROP TRIGGER IF EXISTS contacts_capture ON public.restock_reminders;
CREATE TRIGGER contacts_capture AFTER INSERT ON public.restock_reminders
  FOR EACH ROW EXECUTE FUNCTION public.contacts_capture();
DROP TRIGGER IF EXISTS contacts_capture ON public.orders;
CREATE TRIGGER contacts_capture AFTER INSERT OR UPDATE OF status, customer_email, customer_phone ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.contacts_capture();

-- Everyone already on file.
SELECT public.merge_contact(jsonb_build_object('phone', phone), 'early access')
FROM public.phone_signups ORDER BY created_at;
SELECT public.merge_contact(jsonb_build_object('phone', phone), 'restock request')
FROM public.restock_reminders ORDER BY created_at;
SELECT public.merge_contact(jsonb_strip_nulls(jsonb_build_object(
  'name', customer_name, 'email', customer_email, 'phone', customer_phone,
  'address', shipping_address, 'city', shipping_city, 'state', shipping_state,
  'postcode', shipping_postcode, 'country', shipping_country)), 'order')
FROM public.orders WHERE status IN ('paid', 'fulfilled') ORDER BY created_at;

-- ---------------------------------------------------------------------------
-- Access: the dashboard only
-- ---------------------------------------------------------------------------
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dashboard users manage contacts" ON public.contacts;
CREATE POLICY "Dashboard users manage contacts" ON public.contacts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Dashboard users read contact keys" ON public.contact_keys;
CREATE POLICY "Dashboard users read contact keys" ON public.contact_keys
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.contacts, public.contact_keys FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT SELECT ON public.contact_keys TO authenticated;

REVOKE ALL ON FUNCTION public.merge_contact(jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_contacts(jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contact_fold(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contacts_capture() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contacts_sync_keys() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_contact(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_contacts(jsonb, text) TO authenticated;
