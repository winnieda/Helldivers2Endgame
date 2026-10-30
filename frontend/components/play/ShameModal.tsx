'use client';
import { Modal } from '../ui';

/** Shown when a player unticks "Contribute to the Price Database". Firm, friendly, and their call. */
export function ShameModal({ open, onKeep, onOptOut }: { open: boolean; onKeep: () => void; onOptOut: () => void }) {
  return (
    <Modal open={open} onClose={onKeep} title="A message from the Ministry of Truth">
      <div className="space-y-3 text-text-2 text-[15px] leading-relaxed">
        <p>
          Helldiver, Super Earth respects your <span className="text-text font-semibold">absolute right to refuse</span>. It is, after all, a free galaxy. Opting out is allowed, will never be held against your
          record, and changes nothing about how you play.
        </p>
        <p>
          But know what you’re declining to share: <span className="text-text font-semibold">only the weapons and stratagems you deploy with</span>. Not your name, not your account, not your squad. Just your
          equipment choices will be recorded, completely anonymously.
        </p>
        <p>
          Those picks are the whole Price Database. Every price exists because Helldivers like you reported what they brought. Without them the market can’t tell the meta from the forgotten, and the mode stops
          working for everyone.
        </p>
        <p className="text-[13.5px] text-muted italic">A Democracy Officer has been informed and is choosing to look very, very disappointed rather than file a report.</p>
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button className="btn btn-ghost" onClick={onOptOut}>
          Opt out anyway
        </button>
        <button className="btn btn-primary" onClick={onKeep}>
          Keep contributing
        </button>
      </div>
    </Modal>
  );
}
