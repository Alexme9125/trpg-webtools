"""Atlas portability, host publication, dedicated CoC pools, room configs and chat images."""
import argparse
import json
import re
import struct
import subprocess
import zlib
import zipfile
import hashlib
import uuid
import base64
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:3001')
parser.add_argument('--image-dir', help='Disposable test server image directory; enables physical deletion/placeholder checks')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
out = root / 'test-results/archive'
out.mkdir(parents=True, exist_ok=True)
checks, errors = [], []

def check(name):
    checks.append(name)
    print('PASS', name, flush=True)

def nav(page, name):
    if page.locator('.sidebar').is_visible():
        page.locator('.sidebar').get_by_role('button', name=name, exact=True).click()
    else:
        page.get_by_role('button', name='打开导航', exact=True).click()
        page.locator('.mobile-navigation').get_by_role('button', name=name, exact=True).click()

def close(page):
    page.get_by_role('button', name='关闭窗口', exact=True).click()
    expect(page.get_by_role('dialog')).to_have_count(0)

def tools(page, name):
    if not page.locator('.host-tool-links').is_visible():
        page.get_by_role('button', name='局内工具', exact=True).click()
    page.locator('.host-tool-links').get_by_role('button', name=name, exact=True).click()

def screenshot(page, name):
    page.wait_for_function("[...document.querySelectorAll('.page-enter')].filter(e => e.getClientRects().length).every(e => +getComputedStyle(e).opacity >= 0.99)")
    expect(page.locator('.toast')).to_have_count(0)
    page.screenshot(path=str(out / name), animations='disabled')

def fit(page, name):
    g = page.evaluate('''() => ({v:innerWidth, w:document.documentElement.scrollWidth, dialogs:[...document.querySelectorAll('.modal')].map(e=>({w:e.clientWidth,s:e.scrollWidth,r:e.getBoundingClientRect().right})), children:[...document.querySelectorAll('.atlas-workspace,.atlas-editor,.atlas-index')].map(e=>({w:e.clientWidth,s:e.scrollWidth}))})''')
    assert g['w'] <= g['v'] + 1 and all(d['s'] <= d['w']+1 and d['r'] <= g['v']+1 for d in g['dialogs']) and all(d['s'] <= d['w']+1 for d in g['children']), (name,g)
    check(name)

def download(page, label, filename):
    with page.expect_download() as d:
        page.get_by_role('button', name=label, exact=True).click()
    path = out / filename
    d.value.save_as(str(path))
    return path

def approve(host):
    tools(host, '审核与制卡要求')
    host.get_by_role('button', name='通过此卡', exact=True).click()
    expect(host.get_by_role('button', name='已通过审核', exact=True)).to_be_disabled()
    close(host)

# A deterministic raster fixture; no image service or external data involved.
w,h=640,320
raw=b''.join(b'\x00'+b''.join(bytes((48,91,69)) if x%100<4 or y%80<4 else bytes((225,235,216)) for x in range(w)) for y in range(h))
def chunk(t,d): return struct.pack('!I',len(d))+t+d+struct.pack('!I',zlib.crc32(t+d)&0xffffffff)
image=out/'测试地图.png'
image.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b''))
character = subprocess.check_output([str(root/'node_modules/.bin/tsx'), '-e', 'import { preparedCharacter } from "./tests/fixtures/adjustment-character.ts"; console.log(JSON.stringify(preparedCharacter("coc")));'], cwd=root, text=True)
(out/'coc.json').write_text(character)

with sync_playwright() as p:
    chrome=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    browser=p.chromium.launch(headless=True, **({'executable_path':str(chrome)} if chrome.exists() else {}))
    contexts=[browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True,permissions=['clipboard-read','clipboard-write']) for _ in range(4)]
    # Test the explicit download fallback. Save-picker behavior is exercised separately below.
    contexts[0].add_init_script("Object.defineProperty(window,'showSaveFilePicker',{value:undefined,writable:true,configurable:true})")
    host,player,resumed,returning=[c.new_page() for c in contexts]
    for page in [host,player,resumed,returning]:
        page.set_default_timeout(10000); page.on('pageerror',lambda e: errors.append(str(e)))
    try:
        host.goto(args.url,wait_until='domcontentloaded'); host.locator('.rule-card.coc .rule-choose').click()
        host.get_by_label('你的称呼').fill('KP'); host.get_by_label('房间名称').fill('钟楼 · 未完的旅程')
        host.get_by_role('button',name='创建房间，成为主持人',exact=True).click()
        code=host.locator('.room-code b').inner_text()
        player.goto(args.url,wait_until='domcontentloaded'); player.locator('.rule-card.coc .rule-choose').click()
        player.get_by_role('button',name='加入房间',exact=True).first.click()
        player.get_by_label('你的称呼').fill('归来的调查员'); player.get_by_label('房间码',exact=True).fill(code)
        player.locator('form').get_by_role('button',name='加入房间',exact=True).click()
        player.get_by_role('button',name='创建角色',exact=True).click()
        player.get_by_label('导入角色卡文件').set_input_files(str(out/'coc.json'))
        player.get_by_role('button',name='保存并提交审核',exact=True).click()
        expect(player.locator('.my-review-status')).to_contain_text('等待审核')
        for width in [1440,390,320]:
            player.set_viewport_size({'width':width,'height':950})
            if width<600: player.get_by_role('button',name='同桌伙伴',exact=True).click()
            player.locator('.my-review-status').scroll_into_view_if_needed()
            g=player.locator('.my-review-status').evaluate("e=>{const r=e.getBoundingClientRect(),s=e.querySelector('.review-status-label').getBoundingClientRect(); return {center:r.x+r.width/2,label:s.x+s.width/2,left:s.x,right:s.right,width:innerWidth}}")
            assert abs(g['center']-g['label'])<2 and g['left']>15 and g['right']<g['width']-15,g
            fit(player,f'Review status centered at {width}px'); screenshot(player,f'01-review-{width}.png')
        player.set_viewport_size({'width':1440,'height':1050})
        approve(host)
        player.get_by_role('button',name='我准备好了',exact=True).click(); host.get_by_role('button',name='我准备好了',exact=True).click()
        host.get_by_role('button',name='开启故事',exact=True).click()
        resource = player.locator('.resource-control').first.locator('b')
        before_hp = resource.inner_text().split('/')
        hp = f'{int(before_hp[0])-1}/{before_hp[1]}'
        player.get_by_role('button',name='减少生命',exact=True).click()
        expect(resource).to_have_text(hp)
        host.get_by_role('button',name='主持人暗骰',exact=True).click()
        host.get_by_label('自定义骰子表达式').fill('1d13+47'); host.get_by_role('button',name='让骰子决定',exact=True).click()
        expect(player.locator('.private-label')).to_contain_text('结果隐藏')
        expect(player.locator('.roll-event b')).to_have_text('1d13+47')
        expect(player.locator('.roll-event strong')).to_have_text('？')
        expect(player.locator('.roll-event')).to_contain_text('点数 ？ · 结果 ？')
        assert host.locator('.roll-event strong').inner_text()!='？'
        assert 'success' not in player.locator('.roll-event').get_attribute('class')
        player.reload(wait_until='domcontentloaded'); expect(player.locator('.roll-event strong')).to_have_text('？')
        screenshot(player,'02-secret-roll.png')
        check('Secret dice action and formula visible; results masked after live broadcast and reload')
        player.get_by_label('选择聊天图片文件').set_input_files(str(image))
        player.get_by_label('公开叙事内容').fill('钟楼地图，请记住北侧出口。')
        player.get_by_role('button',name='发送公开消息',exact=True).click()
        expect(host.locator('.chat-image img')).to_have_count(1)
        image_requests=[]
        host.on('request',lambda req: image_requests.append(req.url) if '/images/' in req.url and req.method=='GET' else None)
        tools(host,'全局存档')
        expect(host.get_by_role('checkbox',name='导出图片（仅保留路径引用）')).to_be_checked()
        expect(host.locator('.archive-retention-note')).to_contain_text('14 天')
        expect(host.get_by_role('button',name='下载全局存档 ZIP',exact=True)).to_be_enabled()
        references_archive=download(host,'下载全局存档 ZIP','image-references.zip')
        with zipfile.ZipFile(references_archive) as z:
            reference_files={n:z.read(n) for n in z.namelist()}
            reference_room=json.loads(reference_files['room.json'])
            reference_image=next(e['image'] for e in reference_room['log'] if e.get('image'))
            assert json.loads(reference_files['manifest.json'])['includeImages'] is True
            assert len(reference_files)==4
            assert reference_image['reference']['path'] in reference_files['context.md'].decode()
            assert '14 天' in reference_files['README.md'].decode()
        assert not image_requests,image_requests
        check('Image toggle defaults on; ZIP preserves server path and restore reference without fetching or bundling images')
        host.get_by_role('checkbox',name='导出图片（仅保留路径引用）').uncheck()
        expect(host.get_by_role('button',name='还需填写 1 张图片的描述',exact=True)).to_be_disabled()
        host.locator('.archive-image-row summary').click()
        host.wait_for_function("document.querySelector('.archive-image-row img')?.naturalWidth===640")
        host.get_by_label('图片描述：测试地图.png',exact=True).fill('钟楼一层，北侧楼梯通往二楼；楼梯后有一枚铜钥匙。')
        expect(host.get_by_role('button',name='下载全局存档 ZIP',exact=True)).to_be_enabled()
        expect(host.locator('.archive-save-note')).to_contain_text('下载前询问保存位置')
        screenshot(host,'03-archive-light.png')
        for width in [390,320]:
            host.set_viewport_size({'width':width,'height':950}); fit(host,f'Archive images fit {width}px'); screenshot(host,f'04-archive-{width}.png')
        host.set_viewport_size({'width':1440,'height':1050})
        archive=download(host,'下载全局存档 ZIP','first-session.zip')
        with zipfile.ZipFile(archive) as z:
            files={n:z.read(n) for n in z.namelist()}; saved=json.loads(files['room.json'])
            assert sorted(files)==['README.md','context.md','manifest.json','room.json']
            assert not any(e.get('image') for e in saved['log'])
            assert any('铜钥匙' in e.get('imageDescription',{}).get('description','') for e in saved['log'])
            assert '钟楼地图' in files['context.md'].decode()
        check('Host image descriptions are required; actual ZIP contains full state and textual context, no image binary')
        close(host); host.get_by_role('button',name='切换深色模式',exact=True).click(); tools(host,'全局存档')
        expect(host.get_by_label('图片描述：测试地图.png',exact=True)).to_have_value('钟楼一层，北侧楼梯通往二楼；楼梯后有一枚铜钥匙。')
        screenshot(host,'05-archive-dark.png')
        check('Image descriptions persist for later exports; archive supports dark mode')
        # Exercise the File System Access contract without opening OS dialogs in headless Chromium.
        host.evaluate("""() => { window.showSaveFilePicker=async options=>{window.__saveOptions=options; return {createWritable: async()=>({write:async blob=>{window.__savedBytes=Array.from(new Uint8Array(await blob.arrayBuffer()))},close:async()=>{window.__saveClosed=true},abort:async()=>{window.__saveAborted=true}})}} }""")
        host.get_by_role('button',name='刷新资料',exact=True).click()
        host.get_by_role('button',name='选择保存位置并导出 ZIP',exact=True).click()
        host.wait_for_function('window.__saveClosed===true')
        assert host.evaluate('window.__saveOptions.suggestedName').endswith('-全局存档.zip')
        (out/'picker-session.zip').write_bytes(bytes(host.evaluate('window.__savedBytes')))
        with zipfile.ZipFile(out/'picker-session.zip') as z: assert json.loads(z.read('room.json'))['name']==saved['name']
        check('Save-picker API receives a ZIP filename and writes the generated archive before closing')
        host.evaluate("() => { window.showSaveFilePicker=async()=>{throw new DOMException('Cancelled','AbortError')}; }")
        host.get_by_role('button',name='选择保存位置并导出 ZIP',exact=True).click()
        expect(host.get_by_role('button',name='选择保存位置并导出 ZIP',exact=True)).to_be_enabled()
        expect(host.locator('.room-archive [role=alert]')).to_have_count(0)
        check('Cancelling destination selection leaves export available without an error')
        close(host)
        # Add older valid context to the downloaded fixture to verify paginated restoration in the UI.
        secret=next(e for e in saved['log'] if e['type']=='roll')
        old=[dict(secret,id=str(uuid.uuid4()))]
        old += [{'id':str(uuid.uuid4()),'type':'chat','memberId':saved['hostId'],'name':'KP','content':f'上一晚的记录 {i}','createdAt':saved['createdAt'],'visibility':'public'} for i in range(310)]
        saved['log']=old+saved['log']; files['room.json']=json.dumps(saved,ensure_ascii=False).encode()
        manifest=json.loads(files['manifest.json']); manifest['hashes']['room.json']=hashlib.sha256(files['room.json']).hexdigest(); files['manifest.json']=json.dumps(manifest).encode()
        long_archive=out/'long-session.zip'
        with zipfile.ZipFile(long_archive,'w',zipfile.ZIP_DEFLATED) as z:
            for n,b in files.items(): z.writestr(n,b)
        resumed.goto(args.url,wait_until='domcontentloaded'); resumed.locator('.rule-card.coc .rule-choose').click()
        resumed.get_by_label('你的称呼').fill('续团 KP')
        resumed.get_by_label('全局存档文件').set_input_files(str(long_archive))
        expect(resumed.locator('.gateway-archive-preview')).to_contain_text('进行中')
        expect(resumed.get_by_role('button',name='恢复存档，继续故事',exact=True)).to_be_enabled()
        screenshot(resumed,'06-restore-preview.png')
        for width in [390,320]:
            resumed.set_viewport_size({'width':width,'height':950}); fit(resumed,f'Restore preview fits {width}px')
        resumed.set_viewport_size({'width':1440,'height':1050})
        resumed.get_by_role('button',name='恢复存档，继续故事',exact=True).click()
        expect(resumed.locator('.archive-seats')).to_be_visible()
        new_code=resumed.locator('.archive-seats p b').inner_text(); seat_code=resumed.locator('.archive-seat code').inner_text()
        assert new_code!=code
        resumed.get_by_role('button',name='复制归来的调查员的续团信息',exact=True).click()
        copied=resumed.evaluate('navigator.clipboard.readText()'); assert new_code in copied and seat_code in copied
        for width in [390,320]:
            resumed.set_viewport_size({'width':width,'height':950}); fit(resumed,f'Restored seat codes fit {width}px'); screenshot(resumed,f'07-seats-{width}.png')
        resumed.set_viewport_size({'width':1440,'height':1050}); close(resumed)
        expect(resumed.locator('.status-pill')).to_contain_text('故事进行中')
        expect(resumed.locator('.archived-image')).to_contain_text('铜钥匙')
        check('ZIP preview restores a new active room, textual images and private one-use seat instructions')
        returning.goto(args.url,wait_until='domcontentloaded'); returning.locator('.rule-card.coc .rule-choose').click()
        returning.get_by_role('button',name='加入房间',exact=True).first.click()
        returning.get_by_label('你的称呼').fill('调查员续团'); returning.get_by_label('房间码',exact=True).fill(new_code)
        returning.get_by_label('席位恢复码（续团时填写）').fill('F'*16)
        returning.locator('form').get_by_role('button',name='加入房间',exact=True).click()
        expect(returning.get_by_role('alert')).to_contain_text('恢复码无效')
        returning.get_by_label('席位恢复码（续团时填写）').fill(seat_code)
        returning.locator('form').get_by_role('button',name='加入房间',exact=True).click()
        expect(returning.locator('.status-pill')).to_contain_text('故事进行中')
        expect(returning.locator('.resource-control').first.locator('b')).to_have_text(hp)
        expect(returning.locator('.my-review-status')).to_contain_text('审核')
        expect(returning.get_by_role('button',name='全局存档',exact=True)).to_have_count(0)
        expect(returning.locator('.roll-event strong')).to_have_text('？')
        returning.get_by_role('button',name='加载更早记录',exact=True).click()
        expect(returning.get_by_text('上一晚的记录 0',exact=True)).to_have_count(1)
        expect(returning.locator('.roll-event strong')).to_have_text(['？','？'])
        expect(returning.get_by_role('button',name='加载更早记录',exact=True)).to_have_count(0)
        check('Player reclaims original character and resources; older history loads with secret results still masked')
        returning.get_by_label('公开叙事内容').fill('我们从钟楼二层继续。'); returning.get_by_role('button',name='发送公开消息',exact=True).click()
        expect(resumed.get_by_text('我们从钟楼二层继续。',exact=True)).to_have_count(1)
        returning.reload(wait_until='domcontentloaded'); expect(returning.locator('.resource-control').first.locator('b')).to_have_text(hp)
        resumed.reload(wait_until='domcontentloaded'); expect(resumed.locator('.room-title h1')).to_have_text('钟楼 · 未完的旅程')
        tools(resumed,'全局存档'); expect(resumed.locator('.archive-seats')).to_have_count(0)
        expect(resumed.get_by_text('没有需要处理的图片，可以直接保存。',exact=True)).to_be_visible()
        check('Resumed play synchronizes and survives reload; consumed recovery code disappears and descriptions need no re-entry')
        close(resumed)
        # Malformed archive and rule mismatch surface errors without creating a room.
        invalid=browser.new_context(); bad_page=invalid.new_page(); bad_page.goto(args.url)
        bad_page.locator('.rule-card.dnd .rule-choose').click(); bad_page.get_by_label('全局存档文件').set_input_files(str(archive))
        expect(bad_page.get_by_role('alert')).to_contain_text('规则与所选规则不匹配')
        corrupt=out/'corrupt.zip'; corrupt.write_bytes(b'broken zip')
        bad_page.get_by_label('全局存档文件').set_input_files(str(corrupt)); expect(bad_page.get_by_role('alert')).to_contain_text('无法读取')
        expect(bad_page.locator('.room-code')).to_have_count(0)
        check('Malformed and mismatched archives fail before a room is created')
        # The same reference-only ZIP restores live server images, then placeholders when files are gone.
        def restore_image_archive():
            context=browser.new_context(viewport={'width':1440,'height':1050})
            pg=context.new_page()
            pg.on('pageerror',lambda e: errors.append(str(e)))
            pg.goto(args.url,wait_until='domcontentloaded')
            pg.locator('.rule-card.coc .rule-choose').click()
            pg.get_by_label('你的称呼').fill('图片续团 KP')
            pg.get_by_label('全局存档文件').set_input_files(str(references_archive))
            expect(pg.locator('.gateway-archive-preview')).to_contain_text('1 张图片引用')
            pg.get_by_role('button',name='恢复存档，继续故事',exact=True).click()
            expect(pg.locator('.archive-seats')).to_be_visible()
            close(pg)
            return pg
        referenced=restore_image_archive()
        referenced.wait_for_function("document.querySelector('.chat-image img')?.naturalWidth===640")
        expect(referenced.locator('.chat-image-placeholder')).to_have_count(0)
        screenshot(referenced,'08-restored-original.png')
        check('Reference-only ZIP restores the original image from the same server')
        if args.image_dir:
            filename=reference_image['reference']['path']
            assert re.fullmatch(r'[a-f0-9-]{36}\.png',filename)
            target=Path(args.image_dir).resolve()/filename
            assert target.read_bytes()==image.read_bytes(),'Only delete the specific image uploaded by this test'
            target.unlink()
            missing=restore_image_archive()
            expect(missing.get_by_role('img',name='图片占位：测试地图.png',exact=True)).to_be_visible()
            expect(missing.locator('.chat-image img')).to_have_count(0)
            expect(missing.locator('.chat-image').get_by_role('link',name='保存图片')).to_have_count(0)
            for width in [1440,390,320]:
                missing.set_viewport_size({'width':width,'height':950})
                fit(missing,f'Expired image placeholder fits {width}px')
                screenshot(missing,f'09-placeholder-{width}.png')
            missing.set_viewport_size({'width':1440,'height':1050})
            missing.get_by_role('button',name='切换深色模式',exact=True).click()
            screenshot(missing,'10-placeholder-dark.png')
            missing.reload(wait_until='domcontentloaded')
            expect(missing.locator('.chat-image-placeholder')).to_have_text(re.compile('图片已过期或不可用'))
            check('Deleted server image restores as a persistent placeholder in light/dark mode, without broken image or download link')
        assert not errors,errors
        check('No uncaught browser errors')
        (out/'report.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2))
        print(f'ALL {len(checks)} checks passed',flush=True)
    except Exception:
        for name,page in [('host',host),('player',player),('resumed',resumed),('returning',returning)]:
            try:
                page.screenshot(path=str(out/f'failure-{name}.png'),full_page=True)
                (out/f'failure-{name}.txt').write_text(page.locator('body').inner_text())
            except Exception: pass
        raise
    finally: browser.close()
