const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/routes/lp.$slug.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Update landing-page.functions imports to include ensureResponsiveStyles
const oldImports = `import {
  getSeoLandingPageBySlug,
  type SeoLandingPage,`;

const newImports = `import {
  getSeoLandingPageBySlug,
  ensureResponsiveStyles,
  type SeoLandingPage,`;

if (content.includes(oldImports)) {
  content = content.replace(oldImports, newImports);
} else {
  const oldImportsCRLF = oldImports.replace(/\n/g, '\r\n');
  const newImportsCRLF = newImports.replace(/\n/g, '\r\n');
  content = content.replace(oldImportsCRLF, newImportsCRLF);
}

// 2. Define SectionWrapper component
const wrapperCode = `
/* ─── Responsive Section Wrapper ─── */
function SectionWrapper({ section, children }: { section: LPSection; children: React.ReactNode }) {
  const isBuilder = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("builder") === "1";
  const s = ensureResponsiveStyles(section);
  const styles = s.styles;

  const desktop = styles.desktop || {};
  const mobile = styles.mobile || {};

  const css = \`
    #sec-\${s.id} {
      \${desktop.fontSize ? \`font-size: \${desktop.fontSize} !important;\` : ''}
      \${desktop.textSize ? \`line-height: \${desktop.textSize} !important;\` : ''}
      \${desktop.fontWeight ? \`font-weight: \${desktop.fontWeight} !important;\` : ''}
      \${desktop.alignment ? \`text-align: \${desktop.alignment} !important;\` : ''}
      \${desktop.width ? \`width: \${desktop.width} !important;\` : ''}
      \${desktop.height ? \`height: \${desktop.height} !important;\` : ''}
      \${desktop.padding ? \`padding: \${desktop.padding} !important;\` : ''}
      \${desktop.margin ? \`margin: \${desktop.margin} !important;\` : ''}
      \${desktop.borderRadius ? \`border-radius: \${desktop.borderRadius} !important;\` : ''}
      \${desktop.bgColor ? \`background-color: \${desktop.bgColor} !important;\` : ''}
      \${desktop.textColor ? \`color: \${desktop.textColor} !important;\` : ''}
      \${desktop.visibility === 'hidden' || desktop.display === 'none' 
        ? (isBuilder 
            ? 'opacity: 0.4 !important; outline: 2px dashed #0d9488 !important; outline-offset: -2px !important;' 
            : 'display: none !important;') 
        : ''}
    }

    @media (max-width: 767px) {
      #sec-\${s.id} {
        \${mobile.fontSize ? \`font-size: \${mobile.fontSize} !important;\` : (desktop.fontSize ? \`font-size: \${desktop.fontSize} !important;\` : '')}
        \${mobile.textSize ? \`line-height: \${mobile.textSize} !important;\` : (desktop.textSize ? \`line-height: \${desktop.textSize} !important;\` : '')}
        \${mobile.fontWeight ? \`font-weight: \${mobile.fontWeight} !important;\` : (desktop.fontWeight ? \`font-weight: \${desktop.fontWeight} !important;\` : '')}
        \${mobile.alignment ? \`text-align: \${mobile.alignment} !important;\` : (desktop.alignment ? \`text-align: \${desktop.alignment} !important;\` : '')}
        \${mobile.width ? \`width: \${mobile.width} !important;\` : (desktop.width ? \`width: \${desktop.width} !important;\` : '')}
        \${mobile.height ? \`height: \${mobile.height} !important;\` : (desktop.height ? \`height: \${desktop.height} !important;\` : '')}
        \${mobile.padding ? \`padding: \${mobile.padding} !important;\` : (desktop.padding ? \`padding: \${desktop.padding} !important;\` : '')}
        \${mobile.margin ? \`margin: \${mobile.margin} !important;\` : (desktop.margin ? \`margin: \${desktop.margin} !important;\` : '')}
        \${mobile.borderRadius ? \`border-radius: \${mobile.borderRadius} !important;\` : (desktop.borderRadius ? \`border-radius: \${desktop.borderRadius} !important;\` : '')}
        \${mobile.bgColor ? \`background-color: \${mobile.bgColor} !important;\` : (desktop.bgColor ? \`background-color: \${desktop.bgColor} !important;\` : '')}
        \${mobile.textColor ? \`color: \${mobile.textColor} !important;\` : (desktop.textColor ? \`color: \${desktop.textColor} !important;\` : '')}
        \${mobile.visibility === 'hidden' || mobile.display === 'none' 
          ? (isBuilder 
              ? 'display: block !important; opacity: 0.4 !important; outline: 2px dashed #0d9488 !important; outline-offset: -2px !important;' 
              : 'display: none !important;') 
          : (mobile.display === 'block' ? 'display: block !important;' : '')}
        \${mobile.fullWidth ? 'width: 100% !important; max-width: 100% !important; margin-left: 0 !important; margin-right: 0 !important; border-radius: 0 !important;' : ''}
        \${mobile.order !== undefined ? \`order: \${mobile.order} !important;\` : ''}
      }
    }
  \`;

  return (
    <div id={\`sec-\${s.id}\`} className="transition-all duration-200">
      <style>{css}</style>
      {children}
    </div>
  );
}
`;

// Insert SectionWrapper component right before LPSectionRenderer
const targetPoint = `/* ─── Section dispatcher ────────────────────────────────────────── */`;
content = content.replace(targetPoint, wrapperCode + '\n' + targetPoint);

// 3. Update the sections layout renderer in LandingPage component
const oldLayout = `            <div className="hidden md:block space-y-0">
              {!hasDesktopHeader && <LPNav ctaUrl={page.hero_cta_url} ctaText={page.hero_cta_text} />}
              {desktopSections.map((s: any) => <LPSectionRenderer key={s.id} section={s} />)}
            </div>
            <div className="block md:hidden space-y-0">
              {!hasMobileHeader && <LPNav ctaUrl={page.hero_cta_url} ctaText={page.hero_cta_text} />}
              {mobileSections.map((s: any) => <LPSectionRenderer key={s.id} section={s} />)}
            </div>
          </>
        ) : (
          <>
            {!hasHeaderSection && <LPNav ctaUrl={page.hero_cta_url} ctaText={page.hero_cta_text} />}
            {desktopSections.map((s: any) => <LPSectionRenderer key={s.id} section={s} />)}
          </>
        )`;

const newLayout = `            <div className="hidden md:flex md:flex-col space-y-0">
              {!hasDesktopHeader && <LPNav ctaUrl={page.hero_cta_url} ctaText={page.hero_cta_text} />}
              {desktopSections.map((s: any) => (
                <SectionWrapper key={s.id} section={s}>
                  <LPSectionRenderer section={s} />
                </SectionWrapper>
              ))}
            </div>
            <div className="flex flex-col md:hidden space-y-0">
              {!hasMobileHeader && <LPNav ctaUrl={page.hero_cta_url} ctaText={page.hero_cta_text} />}
              {mobileSections.map((s: any) => (
                <SectionWrapper key={s.id} section={s}>
                  <LPSectionRenderer section={s} />
                </SectionWrapper>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col space-y-0">
            {!hasHeaderSection && <LPNav ctaUrl={page.hero_cta_url} ctaText={page.hero_cta_text} />}
            {desktopSections.map((s: any) => (
              <SectionWrapper key={s.id} section={s}>
                <LPSectionRenderer section={s} />
              </SectionWrapper>
            ))}
          </div>
        )`;

if (content.includes(oldLayout)) {
  content = content.replace(oldLayout, newLayout);
} else {
  const oldLayoutCRLF = oldLayout.replace(/\n/g, '\r\n');
  const newLayoutCRLF = newLayout.replace(/\n/g, '\r\n');
  content = content.replace(oldLayoutCRLF, newLayoutCRLF);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated lp.$slug.tsx renderer');
