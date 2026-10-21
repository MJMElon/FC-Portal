import { useEffect, useImperativeHandle, useRef, forwardRef, useState } from 'react';
import { useLang } from '../../context/LanguageContext.jsx';
import Icon from '../../components/Icon.jsx';

// Touch/mouse signature pad. Exposes { hasSig(), clear(), toDataURL() } via ref.
const SignaturePad = forwardRef(function SignaturePad({ height = 160 }, ref) {
  const { t } = useLang();
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const hasSig = useRef(false);
  const [time, setTime] = useState('');
  const [hintVisible, setHintVisible] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // canvas unsupported (e.g. headless) — nothing to draw on
    // Size to the rendered width once laid out.
    canvas.width = canvas.offsetWidth || canvas.parentElement.offsetWidth || 400;
    canvas.height = height;
    ctx.strokeStyle = '#064e3b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      const s = e.touches ? e.touches[0] : e;
      return {
        x: (s.clientX - r.left) * (canvas.width / r.width),
        y: (s.clientY - r.top) * (canvas.height / r.height),
      };
    };
    const down = (e) => {
      e.preventDefault();
      drawing.current = true;
      hasSig.current = true;
      setHintVisible(false);
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    };
    const move = (e) => {
      if (!drawing.current) return;
      e.preventDefault();
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    };
    const up = () => {
      if (!drawing.current) return;
      drawing.current = false;
      setTime(
        new Date().toLocaleDateString('en-MY') +
          ' ' +
          new Date().toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })
      );
    };

    canvas.addEventListener('mousedown', down);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', up);
    canvas.addEventListener('mouseleave', up);
    canvas.addEventListener('touchstart', down, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', up);
    return () => {
      canvas.removeEventListener('mousedown', down);
      canvas.removeEventListener('mousemove', move);
      canvas.removeEventListener('mouseup', up);
      canvas.removeEventListener('mouseleave', up);
      canvas.removeEventListener('touchstart', down);
      canvas.removeEventListener('touchmove', move);
      canvas.removeEventListener('touchend', up);
    };
  }, [height]);

  useImperativeHandle(ref, () => ({
    hasSig: () => hasSig.current,
    toDataURL: () => canvasRef.current?.toDataURL('image/png'),
    clear: () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      hasSig.current = false;
      setHintVisible(true);
      setTime('');
    },
  }));

  return (
    <div>
      <div className="sig-wrap" style={{ cursor: 'crosshair' }}>
        <canvas ref={canvasRef} height={height} style={{ display: 'block', width: '100%' }} />
        {hintVisible && <div className="sig-hint">{t('do.signHere')}</div>}
      </div>
      <div className="flex justify-between items-center mt-2">
        <button
          onClick={() => ref.current?.clear()}
          className="text-[10px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest bg-slate-50 px-4 py-2 rounded-full border border-slate-200 cursor-pointer transition-colors"
        >
          <Icon name="close" className="w-3 h-3 inline-block align-[-2px]" /> {t('do.clearSig')}
        </button>
        <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">{time}</span>
      </div>
    </div>
  );
});

export default SignaturePad;
