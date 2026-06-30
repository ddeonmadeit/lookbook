import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";

const About = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar sticky={true} glassEffect={true} />

      <main className="pt-20 px-6 pb-32 max-w-2xl mx-auto">
        <h1 className="font-display text-3xl font-bold tracking-[0.2em] uppercase mb-4 text-left">
          About
        </h1>

        <div className="space-y-6 font-body text-sm leading-relaxed text-foreground">
          <p>Knots is a return to balance.</p>
          <p>
            Our clothing is crafted by combining natural elements with urban streetwear, embodying the harmony of nature and tradition.
          </p>
          <p>At our core is connection</p>
          <p>
            Connections between each other, and to the world around us. Community is the foundation of everything we create.
          </p>
          <p>
            Our designs are made to offer not just comfort, but a deeper sense of belonging and presence—reminding us that we are part of something greater.
          </p>
          <p>
            Within the rush of life, there is always space to breathe, to pause, and to return to what is real.
          </p>
          <p>Knots is more than what you wear—it's a pathway home.</p>
        </div>
      </main>

      {/* Glassmorphism EXPLORE button */}
      <div className="fixed bottom-8 left-0 right-0 flex justify-center z-40 pb-[env(safe-area-inset-bottom)]">
        <Link
          to="/"
          className="px-12 py-4 font-display text-sm font-bold tracking-[0.1em] uppercase bg-background/30 backdrop-blur-xl border border-border/30 rounded-full text-foreground hover:bg-background/50 transition-all duration-300 shadow-lg"
        >
          Explore
        </Link>
      </div>
    </div>
  );
};

export default About;
