"""Linux integration test: real Chromium -> VNC -> authenticated viewer -> same Chromium.

Run after building viewer/dist/viewer.js, with Playwright Chromium, Xvfb and x11vnc installed.
Uses an entirely local fixture; no DIA account, card, payment or external API.
"""
import asyncio
import json
import os
import subprocess
import tempfile
from pathlib import Path

import uvicorn
from playwright.async_api import async_playwright


async def main():
    root = Path(__file__).parent
    with tempfile.TemporaryDirectory() as data:
        os.environ.update(SANDBOX_DATA_DIR=data, SANDBOX_TOKEN='local-fixture-only', DISPLAY=':99',
                          SANDBOX_PUBLIC_URL='http://127.0.0.1:18080',
                          MANUAL_CHROMIUM_WRAPPER=str(root / 'browser.sh'),
                          VIEWER_PARENT_ORIGINS='http://localhost:18080',
                          SANDBOX_CALLBACK_URL='http://127.0.0.1:18080/fixture-events')
        from server import app
        from manual import sessions
        from fastapi.responses import HTMLResponse

        @app.post('/fixture-events')
        async def events():
            return {'resolved': True}

        @app.get('/fixture-events')
        async def dispatch():
            return {'ok': True}

        @app.get('/fixture-parent')
        async def parent():
            return HTMLResponse('''<iframe src="http://127.0.0.1:18080/viewer/" width="1200" height="850"></iframe>''')

        xvfb = subprocess.Popen(['Xvfb', ':99', '-screen', '0', '1366x900x24', '-nolisten', 'tcp'],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        await asyncio.sleep(1)
        vnc = subprocess.Popen(['x11vnc', '-display', ':99', '-localhost', '-rfbport', '5901', '-forever',
                                '-nopw', '-shared', '-noclipboard', '-nosel', '-quiet'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        http = uvicorn.Server(uvicorn.Config(app, host='0.0.0.0', port=18080, log_level='error'))
        http_task = asyncio.create_task(http.serve())
        browsers = []
        try:
            for _ in range(100):
                if http.started and await sessions.available():
                    break
                await asyncio.sleep(.1)
            assert await sessions.available(), 'viewer healthcheck failed'
            async with async_playwright() as pw:
                executable = os.environ.get('CHROMIUM_EXECUTABLE')
                if executable:
                    os.environ['MANUAL_CHROMIUM_BINARY'] = executable
                from sandbox import Sandbox
                sb = Sandbox(headed=True, manual=True)
                await sb.start(pw)
                merchant = sb.browser
                browsers.append(merchant)
                context = sb.context
                page = sb.main
                await page.route('http://merchant.test/**', lambda route: route.fulfill(
                    content_type='text/html', body='<h1>Prepared checkout fixture</h1><input id="manual-entry">'))
                await context.add_cookies([{'name': 'fixture_session', 'value': 'already-authenticated', 'url': 'http://merchant.test'}])
                await page.goto('http://merchant.test/checkout')
                await page.evaluate("localStorage.setItem('postcode','1425')")
                await page.locator('#manual-entry').focus()
                record, _ = sessions.store.create('a' * 64, 'local-fixture-buyer')
                job = record['job_id']
                sessions.store.update(job, status='running', preparation='preparing')
                sessions.active = job
                sessions.store.ready(job)
                ticket = sessions.store.ticket(job)

                viewer = await pw.chromium.launch(executable_path=executable)
                browsers.append(viewer)
                host = await viewer.new_page(viewport={'width': 1280, 'height': 1000})
                # The listener is installed before the cross-origin iframe announces readiness.
                await host.add_init_script('''(({job, ticket}) => {
                  window.addEventListener('message', event => {
                    if (event.origin === 'http://127.0.0.1:18080' && event.data?.type === 'changuito-viewer-ready') {
                      event.source.postMessage({type:'changuito-viewer-connect',jobId:job,ticket},event.origin);
                    }
                  });
                })(''' + json.dumps({'job': job, 'ticket': ticket}) + ')')
                await host.goto('http://localhost:18080/fixture-parent')
                frame = host.frame_locator('iframe')
                await frame.locator('#status').filter(has_text='Connected').wait_for(timeout=15000)
                await frame.locator('#keyboard').fill('manual-test-input')
                await page.wait_for_function("document.querySelector('#manual-entry').value === 'manual-test-input'", timeout=10000)
                assert (await context.cookies())[0]['value'] == 'already-authenticated'
                assert await page.evaluate("localStorage.getItem('postcode')") == '1425'
                secret_path = Path(data) / 'worker-private-fixture.txt'
                secret_path.write_text('private fixture; never sent to the browser')
                secret_path.chmod(0o600)
                unguarded = await merchant.new_context()
                probe = await unguarded.new_page()
                denied = False
                try:
                    await probe.goto(secret_path.as_uri())
                except Exception:
                    denied = True
                assert denied, 'interactive browser could read the worker private file'
                await unguarded.close()
                assert not sessions.store.consume(ticket, job), 'ticket replay accepted'
                sessions.store.cancel(job)
                await frame.locator('#status').filter(has_text='Disconnected').wait_for(timeout=10000)
                assert sessions.store.get(job)['preparedAt'], 'closing lost earned preparation'
                print('PASS: isolated browser denies worker private files; cross-origin viewer, authenticated RFB, same-session remote typing, cookie/postcode preservation, ticket replay rejection and cancellation disconnect')
                for browser in browsers:
                    await browser.close()
                browsers.clear()
        finally:
            for browser in browsers:
                await browser.close()
            http.should_exit = True
            await http_task
            vnc.terminate()
            xvfb.terminate()
            vnc.wait(timeout=10)
            xvfb.wait(timeout=10)


if __name__ == '__main__':
    asyncio.run(main())
