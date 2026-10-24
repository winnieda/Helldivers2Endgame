import Link from 'next/link';

export default function ManualIndex() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-14 rise">
      <div className="eyebrow text-yellow">Field manual</div>
      <h1 className="h-display text-[52px] sm:text-[68px]">How much do you want to know?</h1>
      <p className="text-text-2 mt-2 max-w-2xl text-[17px]">Super Earth offers two editions of the manual. Both cover the same game; one just has a lot more in it.</p>
      <div className="mt-10 grid md:grid-cols-2 gap-5">
        <Link href="/manual/basic-training/" className="panel panel-accent p-8 group hover:bg-yellow/[0.04] transition-colors">
          <div className="eyebrow">Short version · about 3 minutes</div>
          <div className="h-display text-[48px] mt-2 group-hover:text-yellow transition-colors">Basic Training</div>
          <p className="text-text-2 mt-3 text-[16px]">
            The rules you need before your first operation, and a walkthrough of how the Galactic Market prices gear. Read this, then go deploy.
          </p>
          <div className="mt-6 btn btn-primary">Start basic training →</div>
        </Link>
        <Link href="/manual/codex/" className="panel p-8 group hover:bg-white/[0.02] transition-colors">
          <div className="eyebrow">Long version · everything</div>
          <div className="h-display text-[48px] mt-2 group-hover:text-yellow transition-colors">The Complete Manual</div>
          <p className="text-text-2 mt-3 text-[16px]">
            Every rule in detail, the exact market equations and their parameters, how we test the economy, where the data comes from, the roadmap and the source code. For divers who read the fine print.
          </p>
          <div className="mt-6 btn btn-ghost">Open the complete manual →</div>
        </Link>
      </div>
    </div>
  );
}
