/** Small, local SVG vocabulary for effect and target controls. */
const shapes={
 tint:'<path d="M12 3C9 7 5 10 5 14a7 7 0 0 0 14 0c0-4-4-7-7-11Z"/><path d="M8 15a4 4 0 0 0 4 4"/>',
 glow:'<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
 outline:'<rect x="3" y="3" width="18" height="18" rx="5"/><rect x="7" y="7" width="10" height="10" rx="2"/>',
 shadow:'<path d="M9 18h8a4 4 0 0 0 4-4V9"/><rect x="3" y="3" width="14" height="14" rx="3"/>',
 blur:'<path d="M3 6h10M3 10h15M6 14h15M11 18h10"/>',
 grade:'<path d="M4 4v16M12 4v16M20 4v16"/><path d="M1 9h6m2 6h6m2-8h6"/>',
 pixelate:'<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
 noise:'<path d="M4 4h.1M12 3h.1M20 6h.1M7 10h.1M15 11h.1M3 17h.1M12 19h.1M20 17h.1" stroke-width="3.5"/>',
 vignette:'<rect x="2" y="4" width="20" height="16" rx="5"/><ellipse cx="12" cy="12" rx="5" ry="4"/>',
 dissolve:'<path d="M3 4h10v16H3zM17 4h.1M20 9h.1M16 14h.1M20 20h.1"/>',
 rgbSplit:'<circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/><path d="M12 5v14"/>',
 wave:'<path d="M2 8c5-10 5 10 10 0s5 10 10 0M2 16c5-10 5 10 10 0s5 10 10 0"/>',
 shockwave:'<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M1 12h2m18 0h2M12 1v2m0 18v2"/>',
 bloom:'<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/>',
 lightSweep:'<path d="m4 21 9-18h7l-9 18ZM3 8h4M17 16h4"/>',
 crt:'<rect x="2" y="5" width="20" height="15" rx="3"/><path d="m8 2 4 3 4-3M6 9h12M6 13h12M6 17h12"/>',
 effects:'<path d="m12 3 2 7 7 2-7 2-2 7-2-7-7-2 7-2ZM20 2v4m-2-2h4"/>',
 grip:'<path d="M9 5h.1m5 0h.1M9 12h.1m5 0h.1M9 19h.1m5 0h.1" stroke-width="3"/>',
 camera:'<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="12" cy="12" r="4"/>',
 movieclip:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4m10 0h4M3 16h4m10 0h4m-10-8 5 4-5 4Z"/>',
};
export const vfxIcon=name=>`<svg class="icon vfx-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]??shapes.effects}</svg>`;
