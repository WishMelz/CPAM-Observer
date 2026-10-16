'use client';

import dynamic from 'next/dynamic';

const ViewerClient = dynamic(() => import('./ViewerClient'), {
  ssr: false,
  loading: () => <div className="viewer-loading" role="status">Loading...</div>,
});

export default function Viewer() { return <ViewerClient />; }