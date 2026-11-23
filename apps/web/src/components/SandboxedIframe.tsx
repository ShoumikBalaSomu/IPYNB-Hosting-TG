/**
 * Strictly Isolated Opaque Sandboxed Iframe
 * Enforces sandbox="allow-scripts" WITHOUT allow-same-origin or allow-top-navigation.
 * Ensures Plotly and arbitrary JavaScript outputs cannot access localStorage, cookies,
 * or parent DOM contexts.
 */

import React, { useEffect, useRef, useState } from 'react';

interface SandboxedIframeProps {
  htmlContent: string;
  className?: string;
  title?: string;
}

export const SandboxedIframe: React.FC<SandboxedIframeProps> = ({
  htmlContent,
  className = '',
  title = 'Isolated Output',
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeHeight, setIframeHeight] = useState<number>(200);
  const [isReady, setIsReady] = useState<boolean>(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Security check: only accept message from our own iframe
      if (iframeRef.current && event.source === iframeRef.current.contentWindow) {
        if (event.data?.type === 'TELEBOOK_IFRAME_READY') {
          setIsReady(true);
        } else if (event.data?.type === 'TELEBOOK_IFRAME_RESIZE' && typeof event.data.height === 'number') {
          setIframeHeight(Math.max(60, event.data.height));
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Post HTML payload once iframe is ready or when content changes
  useEffect(() => {
    if (isReady && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: 'RENDER_PAYLOAD',
          html: htmlContent,
        },
        '*'
      );
    }
  }, [isReady, htmlContent]);

  return (
    <div className={`w-full overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 ${className}`}>
      <iframe
        ref={iframeRef}
        src="/sandbox-frame.html"
        title={title}
        // Staff-engineer security requirement:
        // sandbox="allow-scripts" WITHOUT allow-same-origin!
        sandbox="allow-scripts"
        className="w-full border-0 transition-all duration-150"
        style={{ height: `${iframeHeight}px` }}
        loading="lazy"
      />
    </div>
  );
};
