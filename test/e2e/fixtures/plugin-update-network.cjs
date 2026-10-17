const { app, net } = require('electron');
const http = require('node:http');
const path = require('node:path');
app.setPath('userData', path.join(__dirname, 'native-transport-profile'));
app.commandLine.appendSwitch('disable-gpu');
const { fetchPluginUpdate } = require('./plugin-transport.cjs');
const originalRequest = net.request.bind(net);
const events = [];
net.request = options => {
  const req = originalRequest(options);
  req.on('close', () => events.push('request:close'));
  req.on('response', res => {
    events.push('response:headers');
    res.on('end', () => events.push('response:end'));
  });
  return req;
};
app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/feed' }); res.end(); return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.write('{"version":');
    setTimeout(() => res.end('"1.0.1"}'), 20);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetchPluginUpdate(base + '/feed', { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    console.log('DIRECT_RESPONSE', response.status, await response.text());
    const redirect = await fetchPluginUpdate(base + '/redirect', { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    console.log('REDIRECT_RESPONSE', redirect.status, new URL(redirect.headers.get('location')).pathname);
    const target = await fetchPluginUpdate(redirect.headers.get('location'), { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    console.log('REDIRECT_TARGET', target.status, await target.text());
    console.log('NATIVE_TRANSPORT_SUCCESS');
  } catch (error) {
    console.log('NATIVE_TRANSPORT_ERROR', error.message);
    process.exitCode = 1;
  } finally {
    console.log('EVENT_ORDER', JSON.stringify(events));
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    app.exit(process.exitCode || 0);
  }
});
