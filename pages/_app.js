import '@/styles/globals.css';
import { Toaster } from 'react-hot-toast';
import { useEffect } from 'react';

export default function App({ Component, pageProps }) {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      import('eruda').then(e => e.default.init());
    }
  }, []);

  return (
    <>
      <Toaster position="top-right" />
      <Component {...pageProps} />
    </>
  );
}