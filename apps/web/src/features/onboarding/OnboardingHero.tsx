import { FolderPlus } from "lucide-react";
import { canPickNativeFolder, pickNativeFolder } from "../../core/desktop";

export interface OnboardingHeroProps {
  rootCount: number;
  loading: boolean;
  onAddRoot: (path: string) => Promise<void> | void;
}

/**
 * Empty-state hero shown when the library has no roots configured.
 * Either fires the native folder picker (Electron) or focuses the existing
 * root-path input in `LibrarySidebar` (browser fallback) so onboarding stays
 * inside the same shell.
 */
export function OnboardingHero({ rootCount, loading, onAddRoot }: OnboardingHeroProps) {
  if (loading || rootCount > 0) {
    return null;
  }

  async function chooseFolder() {
    if (canPickNativeFolder()) {
      const folder = await pickNativeFolder();
      if (folder) {
        await onAddRoot(folder);
        return;
      }
    }
    const input = document.querySelector<HTMLInputElement>('[aria-label="Root path"]');
    if (!input) return;
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus();
    input.select();
  }

  return (
    <section className="workspace simple-workspace onboarding-hero" aria-label="Onboarding">
      <header className="toolbar">
        <div>
          <div className="toolbar-title">Welcome to Megle</div>
          <div className="toolbar-meta">No roots yet</div>
        </div>
      </header>
      <div className="onboarding-hero-card">
        <div className="onboarding-hero-icon" aria-hidden="true">
          <FolderPlus size={28} />
        </div>
        <h2 className="onboarding-hero-title">Add a folder to get started</h2>
        <p className="onboarding-hero-copy">
          Megle indexes existing folders without copying their contents. Point it at a
          local directory and your media will start showing up here.
        </p>
        <button
          className="onboarding-hero-cta"
          onClick={() => void chooseFolder()}
          type="button"
        >
          Choose folder
        </button>
      </div>
    </section>
  );
}
