import Link from 'next/link';

export default function ManualIndex() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-14 rise">
      <h1 className="h-display text-[52px] sm:text-[68px]">How much do you want to know?</h1>
      <div className="mt-10 grid md:grid-cols-2 gap-5">
        <Link href="/manual/basic-training/" className="panel panel-accent p-8 flex flex-col group hover:bg-yellow/[0.04] transition-colors">
          <div className="h-display text-[48px] group-hover:text-yellow transition-colors">The Short Version</div>
          <p className="text-text-2 mt-3 text-[16px]">The rules you need before your first operation, and a walkthrough of how prices are set. Read this, then go deploy.</p>
          <div className="mt-auto pt-6">
            <div className="border-t border-line pt-4 text-[15px] text-text-2">
              <span className="font-semibold text-yellow">Basic Training:</span> a tutorial in 3 minutes or less
            </div>
          </div>
        </Link>
        <Link href="/manual/codex/" className="panel p-8 flex flex-col group hover:bg-white/[0.02] transition-colors">
          <div className="h-display text-[48px] group-hover:text-yellow transition-colors">The Long Version</div>
          <p className="text-text-2 mt-3 text-[16px]">
            Every rule in detail, the exact market equations and their parameters, how we test the economy, where the data comes from, the roadmap and the source code. For divers who read the fine print.
          </p>
          <div className="mt-auto pt-6">
            <div className="border-t border-line pt-4 text-[15px] text-text-2">
              <span className="font-semibold text-text">The full developer document.</span> Contains a lot of math; not recommended for people who want to get into the game fast.
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
