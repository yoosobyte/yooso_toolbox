import type { RefObject } from "react";
import type { TFunction } from "../../i18n";
import { BrowserHome } from "./BrowserHome";
import type { BrowserSite } from "./sites";
import type { BrowserTab } from "./types";

interface Props {
  active: BrowserTab | null;
  native: boolean;
  reloadSeq: number;
  frameRef: RefObject<HTMLDivElement | null>;
  sites: BrowserSite[];
  t: TFunction;
  onOpenSite: (site: BrowserSite) => void;
  onEditSite: (site: BrowserSite) => void;
  onRemoveSite: (site: BrowserSite) => void;
  onToggleAutoOpen: (site: BrowserSite, autoOpen: boolean) => void;
  onMenuOpenChange: (open: boolean) => void;
  onAddSite: () => void;
}

export function BrowserContent({
  active,
  native,
  reloadSeq,
  frameRef,
  sites,
  t,
  onOpenSite,
  onEditSite,
  onRemoveSite,
  onToggleAutoOpen,
  onMenuOpenChange,
  onAddSite,
}: Props) {
  return (
    <div className="browser-content">
      {active ? (
        <div className="browser-frame-wrap">
          {native ? (
            <div className="browser-native-frame" ref={frameRef} />
          ) : (
            <iframe
              key={`${active.id}-${reloadSeq}`}
              className="browser-frame"
              title={active.title}
              src={active.url}
              referrerPolicy="no-referrer-when-downgrade"
              allow="clipboard-read; clipboard-write"
            />
          )}
        </div>
      ) : (
        <BrowserHome
          sites={sites}
          t={t}
          onOpenSite={onOpenSite}
          onEditSite={onEditSite}
          onRemoveSite={onRemoveSite}
          onToggleAutoOpen={onToggleAutoOpen}
          onMenuOpenChange={onMenuOpenChange}
          onAddSite={onAddSite}
        />
      )}
    </div>
  );
}
