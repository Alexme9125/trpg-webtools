"""Native IndexedDB acceptance in disposable Chrome contexts; never uses a user profile."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5173')
parser.add_argument('--chrome', help='Optional Chrome executable; otherwise use local Chrome or Playwright Chromium')
args = parser.parse_args()
out = Path('test-results/toolkit-storage')
out.mkdir(parents=True, exist_ok=True)
checks, page_errors, measurements = [], [], {}


def passed(name, details=None):
    checks.append({'name': name, 'details': details or {}})
    print('PASS', name, flush=True)


def prepare(context):
    page = context.new_page()
    page.set_default_timeout(30000)
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    # Serve only a neutral harness from the same origin, avoiding UI/HMR interference.
    page.route('**/__keeper-storage-test', lambda route: route.fulfill(
        status=200, content_type='text/html',
        body='<html><head><title>Native IndexedDB acceptance</title></head>'
             '<body><h1>Native IndexedDB acceptance</h1><p>Disposable test context</p></body></html>'))
    page.goto(args.url.rstrip('/') + '/__keeper-storage-test', wait_until='domcontentloaded')
    page.evaluate('''async () => {
      const storage = await import('/src/keeper-storage.ts');
      const { createKeeperCard } = await import('/shared/keeper.ts');
      window.storageTest = { storage, createKeeperCard };
      window.librarySignature = async cards => {
        const bytes = new TextEncoder().encode(JSON.stringify(cards));
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return { count: cards.length, bytes: bytes.length,
          hash: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') };
      };
      window.writeRawTestLibrary = value => new Promise((resolve, reject) => {
        const request = indexedDB.open('interlude-keeper-library', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction('library', 'readwrite');
          tx.oncomplete = () => { database.close(); resolve(); };
          tx.onabort = () => { database.close(); reject(tx.error); };
          tx.objectStore('library').put(value, 'cards');
        };
      });
      window.readRawTestLibrary = () => new Promise((resolve, reject) => {
        const request = indexedDB.open('interlude-keeper-library', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction('library', 'readonly');
          const get = tx.objectStore('library').get('cards');
          tx.oncomplete = () => { database.close(); resolve(get.result); };
          tx.onabort = () => { database.close(); reject(tx.error); };
        };
      });
    }''')
    return page


with sync_playwright() as playwright:
    chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    launch_options = {'executable_path': args.chrome} if args.chrome else (
        {'executable_path': str(chrome)} if chrome.exists() else {})
    browser = playwright.chromium.launch(headless=True, **launch_options)
    context = browser.new_context(viewport={'width': 1100, 'height': 800})
    outsider_context = browser.new_context(viewport={'width': 1100, 'height': 800})
    failure = None
    try:
        first, second, outsider = prepare(context), prepare(context), prepare(outsider_context)
        assert first.evaluate('async () => (await storageTest.storage.getKeeperLibrary()).length') == 0
        large = first.evaluate('''async () => {
          const base = storageTest.createKeeperCard('monster', { name: 'Large synthetic record' });
          const cards = Array.from({ length: 160 }, (_, index) => ({ ...base,
            id: `large-${index}`, name: `Large synthetic record ${index}`,
            notes: 'N'.repeat(24000), specialAbilities: 'A'.repeat(12000) }));
          const json = JSON.stringify(cards);
          let localStorageFailure = null;
          try { localStorage.setItem('toolkit-storage-capacity-probe', json); }
          catch (error) { localStorageFailure = error.name; }
          finally { localStorage.removeItem('toolkit-storage-capacity-probe'); }
          const saved = await storageTest.storage.saveKeeperCards(cards);
          const signature = await librarySignature(saved);
          window.largeOriginalHash = signature.hash;
          return { ...signature, jsonCharacters: json.length, localStorageFailure };
        }''')
        assert large['count'] == 160 and large['bytes'] > 5 * 1024 * 1024, large
        assert large['localStorageFailure'] == 'QuotaExceededError', large
        assert second.evaluate('async () => await librarySignature(await storageTest.storage.getKeeperLibrary())') == {
            key: large[key] for key in ['count', 'bytes', 'hash']}
        measurements['largeLibrary'] = large
        passed('Native IndexedDB stores and reads a library larger than this Chrome localStorage quota', large)

        first.reload(wait_until='domcontentloaded')
        first.close()
        first = prepare(context)
        reloaded = first.evaluate('async () => await librarySignature(await storageTest.storage.getKeeperLibrary())')
        assert reloaded['hash'] == large['hash']
        assert outsider.evaluate('async () => (await storageTest.storage.getKeeperLibrary()).length') == 0
        passed('Fresh page restores the large library and a separate browser context remains empty')

        start_a = first.evaluate('''() => {
          window.writeStartedAt = Date.now();
          window.concurrentWrite = Promise.all(Array.from({ length: 8 }, (_, index) =>
            storageTest.storage.saveKeeperCards([{ ...storageTest.createKeeperCard('npc-bystander'), id: `concurrent-a-${index}` }]))
          ).then(() => ({ started: window.writeStartedAt, finished: Date.now() }));
          return window.writeStartedAt;
        }''')
        start_b = second.evaluate('''() => {
          window.writeStartedAt = Date.now();
          window.concurrentWrite = Promise.all(Array.from({ length: 8 }, (_, index) =>
            storageTest.storage.saveKeeperCards([{ ...storageTest.createKeeperCard('npc-bystander'), id: `concurrent-b-${index}` }]))
          ).then(() => ({ started: window.writeStartedAt, finished: Date.now() }));
          return window.writeStartedAt;
        }''')
        timing_a = first.evaluate('async () => await window.concurrentWrite')
        timing_b = second.evaluate('async () => await window.concurrentWrite')
        assert start_b < timing_a['finished'] and start_a <= start_b, (timing_a, timing_b)
        concurrent = first.evaluate('''async () => {
          const cards = await storageTest.storage.getKeeperLibrary();
          window.quotaBaseline = cards;
          return { ...await librarySignature(cards), ids: cards.map(card => card.id),
            original: await librarySignature(cards.filter(card => card.id.startsWith('large-'))) };
        }''')
        assert concurrent['count'] == 176 and concurrent['original']['hash'] == large['hash'], concurrent
        assert all(f'concurrent-{side}-{index}' in concurrent['ids'] for side in ['a', 'b'] for index in range(8))
        baseline = {key: concurrent[key] for key in ['count', 'bytes', 'hash']}
        measurements['concurrent'] = {'count': concurrent['count'], 'first': timing_a, 'second': timing_b}
        passed('Overlapping writes from two pages preserve all 16 different IDs and all original cards', measurements['concurrent'])

        quota = first.evaluate('''async () => {
          const prototype = IDBObjectStore.prototype;
          const originalPut = prototype.put;
          const flags = { calls: 0, nativeWriteQueued: false, nativeAbortObserved: false };
          prototype.put = function(value, key) {
            if (this.name === 'library' && this.transaction.db.name === 'interlude-keeper-library' && key === 'cards') {
              flags.calls++;
              this.transaction.addEventListener('abort', () => { flags.nativeAbortObserved = true; });
              originalPut.call(this, value, key);
              flags.nativeWriteQueued = true;
              throw new DOMException('Injected test-page quota failure after native put', 'QuotaExceededError');
            }
            return originalPut.call(this, value, key);
          };
          let rejection = null;
          try {
            await storageTest.storage.saveKeeperCards([{ ...storageTest.createKeeperCard('monster'), id: 'must-not-commit' }]);
          } catch (error) { rejection = error.message; }
          finally { prototype.put = originalPut; }
          return { rejection, flags, after: await librarySignature(await storageTest.storage.getKeeperLibrary()) };
        }''')
        assert quota['rejection'] and '空间不足' in quota['rejection'], quota
        assert quota['flags'] == {'calls': 1, 'nativeWriteQueued': True, 'nativeAbortObserved': True}, quota
        assert quota['after'] == baseline, quota
        measurements['quotaRollback'] = quota
        passed('Quota failure after a native put queues a write aborts the real transaction and preserves the previous library', quota)

        unavailable = first.evaluate('''async () => {
          const descriptor = Object.getOwnPropertyDescriptor(window, 'indexedDB');
          Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
          const failures = [];
          try {
            for (const operation of [
              () => storageTest.storage.getKeeperLibrary(),
              () => storageTest.storage.saveKeeperCards([storageTest.createKeeperCard('monster')]),
              () => storageTest.storage.removeKeeperCard('large-0')
            ]) {
              try { await operation(); failures.push(null); }
              catch (error) { failures.push(error.message); }
            }
          } finally {
            if (descriptor) Object.defineProperty(window, 'indexedDB', descriptor);
            else delete window.indexedDB;
          }
          return { failures, after: await librarySignature(await storageTest.storage.getKeeperLibrary()) };
        }''')
        assert len(unavailable['failures']) == 3 and all(message and '无法使用' in message for message in unavailable['failures']), unavailable
        assert unavailable['after'] == baseline, unavailable
        passed('Unavailable storage rejects reads, saves and deletes instead of returning an empty library', unavailable)

        corrupt = first.evaluate('''async () => {
          const backup = await storageTest.storage.getKeeperLibrary();
          const sentinel = { corrupt: 'isolated-test-record', preserve: true };
          const failures = [];
          let rawPreserved = false;
          try {
            await writeRawTestLibrary(sentinel);
            for (const operation of [
              () => storageTest.storage.getKeeperLibrary(),
              () => storageTest.storage.saveKeeperCards([storageTest.createKeeperCard('monster')]),
              () => storageTest.storage.removeKeeperCard('large-0')
            ]) {
              try { await operation(); failures.push(null); }
              catch (error) { failures.push(error.message); }
            }
            rawPreserved = JSON.stringify(await readRawTestLibrary()) === JSON.stringify(sentinel);
          } finally { await writeRawTestLibrary(backup); }
          return { failures, rawPreserved, after: await librarySignature(await storageTest.storage.getKeeperLibrary()) };
        }''')
        assert len(corrupt['failures']) == 3 and all(message and '数据格式异常' in message for message in corrupt['failures']), corrupt
        assert corrupt['rawPreserved'] and corrupt['after'] == baseline, corrupt
        passed('Corrupt stored data rejects all operations without overwriting it; restoring the test backup recovers the identical library', corrupt)

        assert not page_errors, page_errors
        first.evaluate('checks => { const pre = document.createElement("pre"); pre.textContent = JSON.stringify(checks, null, 2); document.body.append(pre); }', checks)
        first.screenshot(path=str(out / 'native-indexeddb-results.png'), full_page=True)
    except BaseException as error:
        failure = str(error)
        print('FAIL', failure, flush=True)
        raise
    finally:
        (out / 'results.json').write_text(json.dumps({
            'checks': checks, 'measurements': measurements, 'pageErrors': page_errors,
            'failure': failure, 'scope': 'Disposable browser contexts; no user browser profile or data accessed',
        }, ensure_ascii=False, indent=2))
        context.close()
        outsider_context.close()
        browser.close()
