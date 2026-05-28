const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/routes/admin/pages.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add activeMode state inside HomepageBuilder
const oldStates = `  const [cfg, setCfg] = useState<HomepageConfig>(DEFAULT_HOMEPAGE_CONFIG);
  const [saving, setSaving] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);`;

const newStates = `  const [cfg, setCfg] = useState<HomepageConfig>(DEFAULT_HOMEPAGE_CONFIG);
  const [saving, setSaving] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [activeMode, setActiveMode] = useState<"desktop" | "mobile">("desktop");`;

if (content.includes(oldStates)) {
  content = content.replace(oldStates, newStates);
} else {
  const oldStatesCRLF = oldStates.replace(/\n/g, '\r\n');
  const newStatesCRLF = newStates.replace(/\n/g, '\r\n');
  content = content.replace(oldStatesCRLF, newStatesCRLF);
}

// 2. Update previewSrc to add builder=1 for LPs
const oldSrc = `const previewSrc = activeLp ? \`/lp/\${activeLp.slug}\` : activePageId === "book" ? "/book?builder=1" : "/?builder=1";`;
const newSrc = `const previewSrc = activeLp ? \`/lp/\${activeLp.slug}?builder=1\` : activePageId === "book" ? "/book?builder=1" : "/?builder=1";`;

content = content.replace(oldSrc, newSrc);

// 3. Add segmented control in top bar header
const oldHeader = `          {/* Page selector — opens the "Site Menu" modal */}
          <div className="ml-4 flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Page:</span>
            <button
              type="button"
              onClick={() => { setPagesOpen(true); }}
              className="flex h-8 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted"
            >
              {activeName}
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>
        <Button`;

const newHeader = `          {/* Page selector — opens the "Site Menu" modal */}
          <div className="ml-4 flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Page:</span>
            <button
              type="button"
              onClick={() => { setPagesOpen(true); }}
              className="flex h-8 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted"
            >
              {activeName}
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>
        {/* Toggle segmented control di toolbar atas: Desktop | Mobile */}
        {activeLp && (
          <div className="flex rounded-lg border border-stone-200 bg-stone-100 p-0.5 shadow-sm">
            <button
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-4.5 py-1.5 text-xs font-semibold transition",
                activeMode === "desktop"
                  ? "bg-white text-stone-900 shadow-sm"
                  : "text-stone-500 hover:text-stone-700"
              )}
              onClick={() => setActiveMode("desktop")}
            >
              🖥️ Desktop
            </button>
            <button
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-4.5 py-1.5 text-xs font-semibold transition",
                activeMode === "mobile"
                  ? "bg-white text-stone-900 shadow-sm"
                  : "text-stone-500 hover:text-stone-700"
              )}
              onClick={() => setActiveMode("mobile")}
            >
              📱 Mobile
            </button>
          </div>
        )}
        <Button`;

if (content.includes(oldHeader)) {
  content = content.replace(oldHeader, newHeader);
} else {
  const oldHeaderCRLF = oldHeader.replace(/\n/g, '\r\n');
  const newHeaderCRLF = newHeader.replace(/\n/g, '\r\n');
  content = content.replace(oldHeaderCRLF, newHeaderCRLF);
}

// 4. Update preview center iframe container to support Mobile phone frame
const oldPreview = `        {/* ── Centre: live preview ── */}
        <div className="flex flex-1 items-start justify-center overflow-auto p-6">
          <div className="w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-white shadow-lg">
            <iframe
              ref={iframeRef}
              key={\`\${previewKey}-\${previewSrc}\`}
              title="Preview"
              src={previewSrc}
              className="h-[calc(100vh-9rem)] w-full"
            />
          </div>
        </div>`;

const newPreview = `        {/* ── Centre: live preview ── */}
        <div className="flex flex-1 items-center justify-center overflow-auto p-6 bg-stone-100">
          <div
            className={cn(
              "transition-all duration-300 overflow-hidden shadow-xl border border-border bg-white relative",
              activeMode === "mobile" && activeLp
                ? "w-[390px] h-[800px] border-[12px] border-stone-850 rounded-[36px]"
                : "w-full max-w-5xl rounded-xl"
            )}
          >
            {activeMode === "mobile" && activeLp && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-32 h-6 bg-stone-850 rounded-full z-50 flex items-center justify-center">
                <div className="w-12 h-1 bg-stone-700 rounded-full" />
              </div>
            )}
            <iframe
              ref={iframeRef}
              key={\`\${previewKey}-\${previewSrc}-\${activeMode}\`}
              title="Preview"
              src={previewSrc}
              className={cn(
                "w-full transition-all duration-300",
                activeMode === "mobile" && activeLp 
                  ? "h-[776px] pt-4" 
                  : "h-[calc(100vh-9rem)]"
              )}
            />
          </div>
        </div>`;

if (content.includes(oldPreview)) {
  content = content.replace(oldPreview, newPreview);
} else {
  const oldPreviewCRLF = oldPreview.replace(/\n/g, '\r\n');
  const newPreviewCRLF = newPreview.replace(/\n/g, '\r\n');
  content = content.replace(oldPreviewCRLF, newPreviewCRLF);
}

// 5. Update LpPageBuilder invocation with activeMode props
const oldLpb = `<LpPageBuilder sections={lpSections} onChange={setLpSections} />`;
const newLpb = `<LpPageBuilder sections={lpSections} onChange={setLpSections} activeMode={activeMode} setActiveMode={setActiveMode} />`;

content = content.replace(oldLpb, newLpb);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated pages.tsx');
