import "@testing-library/jest-dom/vitest";

if (typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
