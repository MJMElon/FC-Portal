/* The FC Portal's icons, in one vector set -- the same set the Admin
   Portal (mobile) carries at src/components/Icon.jsx, so a module that
   exists in both (Issue Collection DO chief among them) draws the exact
   same glyphs rather than two different emoji that happen to mean the
   same thing. Keep the two files in step: a name added to one belongs on
   the other the moment a page here needs it.

   Usage: <Icon name="camera" className="w-5 h-5" />
   Add a new glyph by adding its path(s) below — PATHS[name] is either one
   "d" string or an array of them, for icons needing more than one <path>. */
const PATHS = {
  clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  pen: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  camera: ['M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z', 'M15 13a3 3 0 11-6 0 3 3 0 016 0z'],
  warning: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  checkCircle: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  check: 'M5 13l4 4L19 7',
  search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  sparkles: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z',
  printer: ['M6 9V4a1 1 0 011-1h10a1 1 0 011 1v5M6 18H5a2 2 0 01-2-2v-5a2 2 0 012-2h14a2 2 0 012 2v5a2 2 0 01-2 2h-1', 'M6 14h12v7H6v-7z'],
  inboxEmpty: 'M20 13V7a2 2 0 00-2-2H6a2 2 0 00-2 2v6m16 0l-2.447 4.894A2 2 0 0115.764 19H8.236a2 2 0 01-1.789-1.106L4 13m16 0h-3.5a1 1 0 00-.894.553l-.712 1.424a1 1 0 01-.894.553h-3.5a1 1 0 01-.894-.553l-.712-1.424A1 1 0 006.5 13H3',
  close: 'M6 18L18 6M6 6l12 12',
  worker: ['M9 20H5a2 2 0 01-2-2v-1a5 5 0 015-5h2m4-7a4 4 0 110 8 4 4 0 010-8z', 'M14 14.5V12a3 3 0 013-3h0a3 3 0 013 3v8h-6v-3.5', 'M13 9h8'],
  lock: ['M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z', 'M8 11V7a4 4 0 118 0v4'],
  seedling: 'M12 21v-7m0 0c-4 0-7-3-7-7 4 0 7 1.5 7 7zm0 0c4 0 7-3 7-7-4 0-7 1.5-7 7z',
  save: ['M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-6 4h6m-6 4h6M9 7V3h6v4'],
};

export default function Icon({ name, className = 'w-5 h-5' }) {
  const d = PATHS[name];
  if (!d) return null;
  const paths = Array.isArray(d) ? d : [d];
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {paths.map((p, i) => (
        <path key={i} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={p} />
      ))}
    </svg>
  );
}
