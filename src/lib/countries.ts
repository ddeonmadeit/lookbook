// Destination countries offered at checkout. Kept as a compact string so the
// list stays readable and diffable; parsed once at module load.
//
// These are the countries Stripe can collect a shipping address for. Anything
// outside Australia, New Zealand, Asia/Pacific and North America/Middle East
// is priced at the "rest of world" rate.

const RAW =
  "AU:Australia,NZ:New Zealand,US:United States,GB:United Kingdom,CA:Canada," +
  "IE:Ireland,DE:Germany,FR:France,NL:Netherlands,BE:Belgium,ES:Spain,IT:Italy," +
  "PT:Portugal,AT:Austria,CH:Switzerland,SE:Sweden,NO:Norway,DK:Denmark," +
  "FI:Finland,IS:Iceland,PL:Poland,CZ:Czechia,SK:Slovakia,HU:Hungary," +
  "RO:Romania,BG:Bulgaria,GR:Greece,HR:Croatia,SI:Slovenia,RS:Serbia," +
  "EE:Estonia,LV:Latvia,LT:Lithuania,LU:Luxembourg,MT:Malta,CY:Cyprus," +
  "JP:Japan,KR:South Korea,CN:China,HK:Hong Kong,TW:Taiwan,MO:Macau," +
  "SG:Singapore,MY:Malaysia,TH:Thailand,VN:Vietnam,PH:Philippines," +
  "ID:Indonesia,IN:India,BD:Bangladesh,LK:Sri Lanka,NP:Nepal,PK:Pakistan," +
  "KH:Cambodia,LA:Laos,BN:Brunei,MN:Mongolia,MV:Maldives," +
  "PG:Papua New Guinea,FJ:Fiji,SB:Solomon Islands,VU:Vanuatu," +
  "NC:New Caledonia,WS:Samoa,TO:Tonga,CK:Cook Islands,PF:French Polynesia," +
  "GU:Guam,AE:United Arab Emirates,SA:Saudi Arabia,QA:Qatar,KW:Kuwait," +
  "BH:Bahrain,OM:Oman,IL:Israel,JO:Jordan,LB:Lebanon,TR:Turkey," +
  "ZA:South Africa,EG:Egypt,MA:Morocco,KE:Kenya,NG:Nigeria,GH:Ghana," +
  "TZ:Tanzania,MU:Mauritius,BR:Brazil,MX:Mexico,AR:Argentina,CL:Chile," +
  "CO:Colombia,PE:Peru,UY:Uruguay,EC:Ecuador,CR:Costa Rica,PA:Panama";

export interface Country {
  code: string;
  name: string;
}

export const COUNTRIES: Country[] = RAW.split(",")
  .map((entry) => {
    const [code, name] = entry.split(":");
    return { code, name };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

export const COUNTRY_CODES = COUNTRIES.map((c) => c.code);

export function countryName(code: string): string {
  return COUNTRIES.find((c) => c.code === code)?.name ?? code;
}
