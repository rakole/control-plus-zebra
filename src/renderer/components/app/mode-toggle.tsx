import * as React from "react";
import { CheckIcon, LaptopMinimalIcon, MoonStarIcon, SunMediumIcon } from "lucide-react";

import { Button } from "../ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../ui/dropdown-menu.js";
import { useTheme } from "../../providers/theme-provider.js";

export type ThemeMode = "system" | "light" | "dark";

export interface ModeToggleProps {
  value?: ThemeMode | undefined;
  onValueChange?: ((value: ThemeMode) => void) | undefined;
  disabled?: boolean | undefined;
}

const modeOptions = [
  {
    value: "system",
    label: "System",
    icon: LaptopMinimalIcon
  },
  {
    value: "light",
    label: "Light",
    icon: SunMediumIcon
  },
  {
    value: "dark",
    label: "Dark",
    icon: MoonStarIcon
  }
] as const;

export function ModeToggle({
  value,
  onValueChange,
  disabled
}: ModeToggleProps) {
  const theme = useOptionalTheme();
  const resolvedValue = value ?? theme?.preference ?? "system";
  const resolvedOnValueChange = onValueChange ?? theme?.setThemePreference;
  const current = modeOptions.find((option) => option.value === resolvedValue) ?? modeOptions[0];
  const CurrentIcon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={`Theme mode: ${current.label}`}
        >
          <CurrentIcon className="size-3.5" />
          <span>{current.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {modeOptions.map((option) => {
          const OptionIcon = option.icon;

          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => void resolvedOnValueChange?.(option.value)}
            >
              <OptionIcon className="size-3.5" />
              <span className="flex-1">{option.label}</span>
              {resolvedValue === option.value ? <CheckIcon className="size-3.5" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useOptionalTheme() {
  try {
    return useTheme();
  } catch {
    return null;
  }
}
