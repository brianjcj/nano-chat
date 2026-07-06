import type { UserSummary } from "@/shared/api/types";

export type AvatarUser = Pick<
  UserSummary,
  "user_id" | "username" | "display_name"
>;

export type AvatarVisual = {
  initials: string;
  gradientToken: string;
  gradientClassName: string;
};

const avatarGradients = [
  {
    token: "cool-ink-harbor",
    className:
      "bg-[linear-gradient(135deg,var(--foreground)_0%,color-mix(in_oklab,var(--accent)_82%,var(--foreground))_54%,color-mix(in_oklab,var(--primary)_70%,var(--foreground))_100%)]",
  },
  {
    token: "cool-ink-estuary",
    className:
      "bg-[linear-gradient(135deg,color-mix(in_oklab,var(--accent)_70%,var(--foreground))_0%,var(--primary)_52%,color-mix(in_oklab,var(--ring)_74%,var(--foreground))_100%)]",
  },
  {
    token: "cool-ink-slate",
    className:
      "bg-[linear-gradient(135deg,var(--accent)_0%,#17435f_48%,color-mix(in_oklab,var(--primary)_66%,var(--foreground))_100%)]",
  },
  {
    token: "cool-ink-tide",
    className:
      "bg-[linear-gradient(135deg,#123a4f_0%,color-mix(in_oklab,var(--ring)_58%,var(--accent))_50%,var(--primary)_100%)]",
  },
  {
    token: "cool-ink-depth",
    className:
      "bg-[linear-gradient(135deg,var(--foreground)_0%,#1f4f6d_46%,var(--accent)_100%)]",
  },
  {
    token: "cool-ink-signal",
    className:
      "bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_64%,var(--foreground))_0%,var(--accent)_56%,color-mix(in_oklab,var(--ring)_68%,var(--foreground))_100%)]",
  },
] as const;

const INITIAL_FALLBACK = "?";

export function getAvatarInitials(user: AvatarUser): string {
  const source = getAvatarNameSource(user);
  const words = source
    .replace(/[_@.-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length >= 2) {
    return [firstVisibleCharacter(words[0]), firstVisibleCharacter(words[1])]
      .join("")
      .toUpperCase();
  }

  const compactName = words[0] ?? source;
  const initials = Array.from(compactName)
    .filter(isVisibleInitialCharacter)
    .slice(0, 2)
    .join("");

  return (initials || INITIAL_FALLBACK).toUpperCase();
}

export function getAvatarGradient(userId: string) {
  return avatarGradients[stableHash(userId) % avatarGradients.length];
}

export function getAvatarVisual(user: AvatarUser): AvatarVisual {
  const gradient = getAvatarGradient(user.user_id);

  return {
    initials: getAvatarInitials(user),
    gradientToken: gradient.token,
    gradientClassName: gradient.className,
  };
}

function getAvatarNameSource(user: AvatarUser) {
  return user.display_name?.trim() || user.username.trim() || INITIAL_FALLBACK;
}

function firstVisibleCharacter(value: string) {
  return Array.from(value).find(isVisibleInitialCharacter) ?? INITIAL_FALLBACK;
}

function isVisibleInitialCharacter(value: string) {
  return /[\p{L}\p{N}]/u.test(value);
}

function stableHash(value: string) {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }

  return hash;
}
