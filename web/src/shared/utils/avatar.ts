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
    token: "soft-social-sunrise",
    className:
      "bg-[linear-gradient(135deg,#ff8a7a_0%,#ffd0b0_52%,#8a6dff_100%)]",
  },
  {
    token: "soft-social-orchid",
    className:
      "bg-[linear-gradient(135deg,#a78bfa_0%,#f0abfc_48%,#fed7aa_100%)]",
  },
  {
    token: "soft-social-mint",
    className:
      "bg-[linear-gradient(135deg,#5eead4_0%,#bae6fd_45%,#f9a8d4_100%)]",
  },
  {
    token: "soft-social-peach",
    className:
      "bg-[linear-gradient(135deg,#fb7185_0%,#fdba74_50%,#fde68a_100%)]",
  },
  {
    token: "soft-social-lagoon",
    className:
      "bg-[linear-gradient(135deg,#38bdf8_0%,#c4b5fd_54%,#fbcfe8_100%)]",
  },
  {
    token: "soft-social-meadow",
    className:
      "bg-[linear-gradient(135deg,#86efac_0%,#fef08a_52%,#fda4af_100%)]",
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
      .toLocaleUpperCase();
  }

  const compactName = words[0] ?? source;
  const initials = Array.from(compactName)
    .filter(isVisibleInitialCharacter)
    .slice(0, 2)
    .join("");

  return (initials || INITIAL_FALLBACK).toLocaleUpperCase();
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
