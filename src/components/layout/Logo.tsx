/* eslint-disable @next/next/no-img-element */
import React from 'react';

const SRC = '/spaco-logo.png';
// Logo PNG is 480 × 407 (full lockup including tagline).
// The square mark portion takes roughly the top 78% of the image.
const FULL_W = 480;
const FULL_H = 407;
const MARK_RATIO = 0.78; // visual height of square mark / total image height
const MARK_ASPECT = FULL_W / (FULL_H * MARK_RATIO); // ~1.51:1

interface LogoProps {
  /** Width in px. */
  size?: number;
  /** Show the "MULTIFUNCTIONAL SPACE" tagline (full lockup) */
  showTagline?: boolean;
  /** 'invert' flips the black mark to white for dark backgrounds. */
  variant?: 'default' | 'invert';
  className?: string;
}

/**
 * SPACO logo. Sources from /public/spaco-logo.png.
 * - showTagline = true  → full lockup (mark + "MULTIFUNCTIONAL SPACE")
 * - showTagline = false → just the bracketed square wordmark (top portion)
 */
export default function Logo({
  size = 140,
  showTagline = true,
  variant = 'default',
  className = '',
}: LogoProps) {
  const filter = variant === 'invert' ? 'invert(1) brightness(2)' : undefined;

  if (showTagline) {
    // Full image, natural aspect ratio
    return (
      <img
        src={SRC}
        alt="SPACO — Multifunctional Space"
        width={size}
        height={Math.round((size * FULL_H) / FULL_W)}
        style={{ filter, display: 'block' }}
        className={`object-contain ${className}`}
      />
    );
  }

  // Mark only — render a viewport that's the size of the mark, with the
  // background-image positioned so only the top portion shows.
  const markH = Math.round(size / MARK_ASPECT);
  return (
    <div
      role="img"
      aria-label="SPACO"
      className={className}
      style={{
        width: size,
        height: markH,
        backgroundImage: `url(${SRC})`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'top center',
        backgroundSize: `${size}px auto`, // image scales to width, top portion visible
        filter,
      }}
    />
  );
}

/**
 * Compact horizontal lockup for tight horizontal slots (header pill).
 * Always crops out the tagline.
 */
export function LogoInline({
  size = 32,
  variant = 'default',
  className = '',
}: Pick<LogoProps, 'size' | 'variant' | 'className'>) {
  // size = height in px
  const width = Math.round(size * MARK_ASPECT);
  return (
    <Logo
      size={width}
      showTagline={false}
      variant={variant}
      className={className}
    />
  );
}
