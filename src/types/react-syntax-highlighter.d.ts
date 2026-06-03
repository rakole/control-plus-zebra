declare module "react-syntax-highlighter" {
  import * as React from "react";

  export interface SyntaxHighlighterProps {
    children?: React.ReactNode;
    language?: string;
    style?: Record<string, React.CSSProperties>;
    wrapLongLines?: boolean;
    customStyle?: React.CSSProperties;
    codeTagProps?: React.HTMLAttributes<HTMLElement>;
    PreTag?: keyof React.JSX.IntrinsicElements | React.ComponentType<unknown>;
  }

  export const PrismLight: React.ComponentType<SyntaxHighlighterProps> & {
    registerLanguage: (name: string, language: unknown) => void;
  };
}

declare module "react-syntax-highlighter/dist/esm/languages/prism/bash" {
  const bash: unknown;
  export default bash;
}

declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  import * as React from "react";

  export const oneDark: Record<string, React.CSSProperties>;
}
