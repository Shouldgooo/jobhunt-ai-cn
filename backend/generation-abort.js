'use strict';

/**
 * Abort Gemini only when the *response* connection actually dies,
 * not when the request readable stream closes after express.json()
 * finishes the POST body.
 */

const CLIENT_DISCONNECTED = 'CLIENT_DISCONNECTED';

function abortReasonText(reason) {
  if (reason == null) return 'none';
  if (typeof reason === 'string') return reason;
  if (typeof reason === 'symbol') return reason.toString();
  if (reason instanceof Error) return reason.name || 'Error';
  return 'unknown';
}

function attachClientDisconnectAbort(req, res, ac) {
  let detached = false;

  const abortForDisconnect = (source) => {
    if (detached || res.writableEnded || ac.signal.aborted) return;
    console.log(`[cancel] ${source}`);
    ac.abort(CLIENT_DISCONNECTED);
  };

  const onReqAborted = () => abortForDisconnect('request aborted');
  const onResClose = () => {
    if (detached || res.writableEnded) return;
    abortForDisconnect('response closed before completion');
  };

  // Do NOT use req.on('close'). After the POST body is fully received,
  // IncomingMessage commonly emits 'close' while the NDJSON response is
  // still open and Gemini is still generating.
  req.on('aborted', onReqAborted);
  res.on('close', onResClose);

  return function detachClientDisconnectAbort() {
    detached = true;
    req.off('aborted', onReqAborted);
    res.off('close', onResClose);
  };
}

module.exports = {
  CLIENT_DISCONNECTED,
  abortReasonText,
  attachClientDisconnectAbort,
};
