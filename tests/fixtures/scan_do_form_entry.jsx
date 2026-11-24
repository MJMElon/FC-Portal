import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '../../src/context/LanguageContext.jsx';
import EntryModal from '../../src/modules/do/EntryModal.jsx';

const plots = [
  { nursery_name: 'BNN', plot_name: 'B2' },
  { nursery_name: 'BNN', plot_name: 'B3' },
];
const batchMap = new Map([['B2', [{ batch: '270', qty: 500 }]], ['B3', [{ batch: '271', qty: 300 }]]]);
window.__saved = null;
createRoot(document.getElementById('root')).render(
  <LanguageProvider>
    <EntryModal
      al={{ al_number: 'AL-1', customer_name: 'Imbok Sdn Bhd', balance_quantity: 1000 }}
      plots={plots} breeds={[]} batchMap={batchMap} photoBase64={null}
      initialQty={40} scannedQty={40}
      toast={() => {}}
      onSubmit={async ({ payload }) => { window.__saved = payload; return { payload, queued: false }; }}
      onSaved={() => { window.__done = true; }}
      onClose={() => { window.__closed = true; }}
    />
  </LanguageProvider>
);
