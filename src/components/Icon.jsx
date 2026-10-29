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
  refresh: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  tool: 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z',
  calculator: 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z',
  power: ['M12 3v7', 'M7.5 6.5a7 7 0 109 0'],
  blocked: 'M18.364 5.636a9 9 0 11-12.728 0 9 9 0 0112.728 0zM5.636 5.636l12.728 12.728',
  share: 'M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z',
  map: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6-10l6 3m0 0l5.447-2.724A1 1 0 0122 7.618v10.764a1 1 0 01-.553.894L15 20m0-13v13',
  folder: 'M3 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
  hourglass: 'M6 2h12M6 22h12M6 2c0 6 4 7 4 10s-4 4-4 10M18 2c0 6-4 7-4 10s4 4 4 10',
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
