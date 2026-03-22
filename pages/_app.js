import '@/styles/globals.css';
import { Toaster } from 'react-hot-toast';

useEffect(() => {
  if (typeof window !== 'undefined') {
    import('eruda').then(e => e.default.init());
  }
}, []);

export default function App({ Component, pageProps }) {
  return (
    <>
      <Toaster position="top-right" />
      <Component {...pageProps} />
    </>
  );
}