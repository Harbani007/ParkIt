import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export default function Home() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api('/health')
      .then(setHealth)
      .catch((err) => setHealth({ status: 'error', db: 'unknown', error: err.message }));
  }, []);

  return (
    <section>
      <h1>Park in spare spaces, booked ahead.</h1>
      <p>Check availability, see the price, and reserve a slot with a QR booking ID.</p>
      <p className="muted">
        API: {health ? `${health.status} (database ${health.db})` : 'checking…'}
      </p>
    </section>
  );
}
