import { FolderPlus } from "lucide-react";

export interface OnboardingHeroProps {
  rootCount: number;
  loading: boolean;
}

/**
 * Empty-state hero shown when the library has no roots configured.
 * Focuses the existing root path input in `LibrarySidebar` rather than
 * introducing a parallel form, so onboarding stays inside the same shell.
 */
export function OnboardingHero({ rootCount, loading }: OnboardingHeroProps) {
  if (loading || rootCount > 0) {
    return null;
  }

  function focusRootInput() {
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
          onClick={focusRootInput}
          type="button"
        >
          Choose folder
        </button>
      </div>
    </section>
  );
}
