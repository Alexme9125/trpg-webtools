"""Atlas portability, host publication, dedicated CoC pools, room configs and chat images."""
import argparse
import json
import re
import struct
import subprocess
import zlib
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:3001')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
out = root / 'test-results/preparation'
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
    hc=browser.new_context(viewport={'width':1440,'height':1000}, accept_downloads=True, permissions=['clipboard-read','clipboard-write'])
    pc=browser.new_context(viewport={'width':1440,'height':1000}, accept_downloads=True)
    hc2=browser.new_context(viewport={'width':1440,'height':1000}, accept_downloads=True)
    host, player, other = hc.new_page(), pc.new_page(), hc2.new_page()
    for page in [host,player,other]:
        page.set_default_timeout(10000)
        page.on('pageerror',lambda error: errors.append(str(error)))
    try:
        host.goto(args.url,wait_until='domcontentloaded')
        nav(host,'主持人工具集')
        host.get_by_role('button',name='地图与场景',exact=True).click()
        screenshot(host,'01-atlas-toolkit-light.png')
        host.get_by_role('button',name='提取提示词、模板与教程',exact=True).click()
        host.get_by_role('button',name='复制地图提取提示词',exact=True).click()
        expect(host.get_by_role('button',name='提示词已复制',exact=True)).to_be_visible()
        prompt=host.evaluate('navigator.clipboard.readText()')
        assert 'atlas-source' in prompt and 'keeperNotes' in prompt
        template=download(host,'下载地图 Markdown 模板','atlas-template.md')
        download(host,'下载地图文字教程','atlas-guide.md')
        assert 'mapKey' in template.read_text()
        check('Map prompt copied and actual Markdown template/tutorial downloaded')
        host.get_by_role('button',name='打开个人地图集',exact=True).click()
        host.get_by_label('导入地图集文件').set_input_files(str(template))
        expect(host.get_by_label('地图导入预览')).to_contain_text('3 个场景')
        expect(host.locator('.atlas-book')).to_have_count(0)
        host.get_by_role('button',name='确认导入地图集',exact=True).click()
        expect(host.locator('.atlas-book')).to_have_count(1)
        host.get_by_role('button',name='打开地图册：雾港来信 · 地图册',exact=True).click()
        host.get_by_role('button',name='查看场景：紧闭的仓库',exact=True).click()
        expect(host.get_by_label('场景主持人笔记')).to_contain_text('守夜人')
        host.get_by_label('场景主持人笔记').fill('私密线索：守夜人持有一把铜钥匙。')
        host.get_by_role('button',name='保存地图册',exact=True).click()
        expect(host.get_by_role('status')).to_contain_text('地图册已保存')
        original=json.loads(download(host,'导出 JSON','atlas-original.json').read_text())['atlases'][0]
        exported_md=download(host,'导出 Markdown','atlas-export.md')
        close(host)
        host.reload(wait_until='domcontentloaded')
        nav(host,'主持人工具集'); host.get_by_role('button',name='地图与场景',exact=True).click()
        host.get_by_role('button',name='打开个人地图集',exact=True).click()
        host.get_by_role('button',name='打开地图册：雾港来信 · 地图册',exact=True).click()
        host.get_by_role('button',name='查看场景：紧闭的仓库',exact=True).click()
        expect(host.get_by_label('场景主持人笔记')).to_have_value('私密线索：守夜人持有一把铜钥匙。')
        check('Imported multi-map/multi-scene atlas saves, exports and survives browser reload')
        host.get_by_label('搜索地图与场景').fill('钟室')
        expect(host.locator('.atlas-scene-list > button')).to_have_count(1)
        host.get_by_label('搜索地图与场景').fill('')
        host.get_by_label('按地图筛选场景').select_option(label='北岸灯塔')
        expect(host.locator('.atlas-scene-list > button')).to_have_count(1)
        host.get_by_label('按地图筛选场景').select_option('all')
        check('Scene search and map filtering select the intended subset')
        screenshot(host,'02-atlas-editor-light.png'); fit(host,'Desktop atlas editor fits')
        close(host); host.get_by_role('button',name='切换深色模式',exact=True).click()
        host.get_by_role('button',name='打开个人地图集',exact=True).click()
        host.get_by_role('button',name='打开地图册：雾港来信 · 地图册',exact=True).click()
        host.get_by_role('button',name='查看场景：紧闭的仓库',exact=True).click()
        screenshot(host,'03-atlas-editor-dark.png')
        for width in [390,320]:
            host.set_viewport_size({'width':width,'height':900})
            host.get_by_label('公开场景描述').scroll_into_view_if_needed()
            fit(host,f'{width}px dark atlas fits'); screenshot(host,f'04-atlas-{width}.png')
        host.set_viewport_size({'width':1440,'height':1000}); close(host)
        host.get_by_role('button',name='切换浅色模式',exact=True).click()
        # A second browser imports the exported Markdown; it never sees the host library automatically.
        other.goto(args.url,wait_until='domcontentloaded'); nav(other,'主持人工具集')
        other.get_by_role('button',name='地图与场景',exact=True).click()
        other.get_by_role('button',name='打开个人地图集',exact=True).click()
        expect(other.locator('.atlas-book')).to_have_count(0)
        other.get_by_label('导入地图集文件').set_input_files(str(exported_md))
        other.get_by_role('button',name='确认导入地图集',exact=True).click()
        expect(other.locator('.atlas-book')).to_have_count(1); close(other)
        check('Personal atlases are private across browsers and portable via exported Markdown')
        # Host room plus independent atlas copy.
        nav(host,'入席'); host.locator('.rule-card.coc .rule-choose').click()
        host.get_by_label('你的称呼').fill('地图 KP'); host.get_by_label('房间名称').fill('雾港备团验收')
        host.get_by_role('button',name='创建房间，成为主持人',exact=True).click()
        expect(host.locator('.room-title h1')).to_have_text('雾港备团验收')
        code=host.locator('.room-code b').inner_text()
        nav(host,'主持人工具集'); host.get_by_role('button',name='地图与场景',exact=True).click()
        host.get_by_role('button',name='打开个人地图集',exact=True).click()
        host.get_by_role('button',name='打开地图册：雾港来信 · 地图册',exact=True).click()
        host.get_by_role('button',name='带入房间',exact=True).click()
        expect(host.get_by_role('status')).to_contain_text('独立副本'); close(host)
        host.locator('.app-header').get_by_role('button',name='返回房间',exact=True).click()
        tools(host,'地图与场景')
        host.get_by_role('button',name='打开地图册：雾港来信 · 地图册',exact=True).click()
        room_atlas=json.loads(download(host,'导出 JSON','room-atlas.json').read_text())['atlases'][0]
        assert room_atlas['id']!=original['id'] and room_atlas['maps'][0]['id']!=original['maps'][0]['id']
        host.get_by_role('button',name='查看场景：紧闭的仓库',exact=True).click()
        host.get_by_role('button',name='公布此场景',exact=True).click()
        expect(host.get_by_role('status')).to_contain_text('场景已公布')
        screenshot(host,'05-scene-publication.png'); close(host)
        expect(host.locator('.current-scene')).to_contain_text('紧闭的仓库')
        player.goto(args.url,wait_until='domcontentloaded'); player.locator('.rule-card.coc .rule-choose').click()
        player.get_by_role('button',name='加入房间',exact=True).first.click()
        player.get_by_label('你的称呼').fill('调查员'); player.get_by_label('房间码',exact=True).fill(code)
        player.locator('form').get_by_role('button',name='加入房间',exact=True).click()
        expect(player.locator('.current-scene')).to_contain_text('紧闭的仓库')
        expect(player.get_by_text('私密线索：守夜人持有一把铜钥匙。',exact=True)).to_have_count(0)
        expect(player.get_by_role('button',name='地图与场景',exact=True)).to_have_count(0)
        check('Room copy has independent IDs; scene publication syncs without revealing host notes')
        # Existing allocation remains visible but must be corrected after policy changes.
        player.get_by_role('button',name='创建角色',exact=True).click()
        player.get_by_label('导入角色卡文件').set_input_files(str(out/'coc.json'))
        player.get_by_role('button',name='保存并提交审核',exact=True).click()
        tools(host,'审核与制卡要求')
        host.get_by_role('button',name='剧本限制',exact=True).click()
        host.get_by_label('允许兴趣点投入职业技能（含信用评级）',exact=True).uncheck()
        host.get_by_role('button',name='保存限制并重新审核',exact=True).click()
        expect(host.locator('.modal-header p')).to_contain_text('第 2 版'); close(host)
        expect(player.get_by_role('button',name='我准备好了',exact=True)).to_be_disabled()
        player.get_by_role('button',name='编辑角色卡',exact=True).click()
        player.get_by_role('button',name='技能与熟练',exact=True).click()
        expect(player.get_by_label('历史兴趣点',exact=True)).to_be_disabled()
        player.get_by_role('button',name='退回职业技能上的兴趣点',exact=True).click()
        expect(player.get_by_label('历史兴趣点',exact=True)).to_have_value('0')
        player.get_by_role('button',name='建议分配',exact=True).click()
        expect(player.get_by_label('历史兴趣点',exact=True)).to_have_value('0')
        player.get_by_role('button',name='保存并提交审核',exact=True).click()
        approve(host)
        player.get_by_role('button',name='我准备好了',exact=True).click(); host.get_by_role('button',name='我准备好了',exact=True).click()
        expect(host.get_by_role('button',name='开启故事',exact=True)).to_be_enabled()
        check('Dedicated pools lock occupational interest, explicitly refund old points and gate readiness/review')
        # Export, preview and atomically apply room configuration.
        tools(host,'房间配置')
        cfg_path=download(host,'导出配置 JSON','room-config.json')
        cfg_md=download(host,'导出配置 Markdown','room-config.md')
        config=json.loads(cfg_path.read_text())
        assert config['creationPolicy']['allowInterestOnOccupation'] is False
        assert config['scene']['title']=='紧闭的仓库'
        assert set(config)=={'documentType','schemaVersion','rule','name','mode','creationPolicy','scene'}
        config['name']='雾港 · 配置复用'; modified=out/'modified-config.json'; modified.write_text(json.dumps(config,ensure_ascii=False))
        host.get_by_label('房间配置文件').set_input_files(str(modified))
        expect(host.locator('.configuration-incoming')).to_contain_text('雾港 · 配置复用')
        screenshot(host,'06-config-preview-light.png')
        for width in [390,320]:
            host.set_viewport_size({'width':width,'height':900}); fit(host,f'{width}px config fits')
        host.set_viewport_size({'width':1440,'height':1000})
        host.get_by_role('button',name='应用配置并重新审核',exact=True).click()
        expect(host.get_by_role('status')).to_contain_text('房间配置已应用'); close(host)
        expect(host.locator('.room-title h1')).to_have_text('雾港 · 配置复用')
        expect(player.locator('.my-review-status')).to_contain_text('等待审核')
        expect(host.get_by_role('button',name='开启故事',exact=True)).to_be_disabled()
        check('Configuration JSON/Markdown export, preview and application reset stale approvals')
        # Fresh-room creation from config file.
        nav(other,'入席'); other.locator('.rule-card.coc .rule-choose').click()
        other.get_by_label('你的称呼').fill('新房间 KP')
        other.get_by_label('新房间配置文件').set_input_files(str(cfg_md))
        expect(other.get_by_label('房间名称')).to_have_value('雾港备团验收')
        other.get_by_role('button',name='创建房间，成为主持人',exact=True).click()
        expect(other.locator('.current-scene')).to_contain_text('紧闭的仓库')
        assert other.locator('.room-code b').inner_text()!=code
        tools(other,'房间配置'); expect(other.locator('.configuration-summary')).to_contain_text('专点专用'); close(other)
        check('A new room imports Markdown configuration with a new room code and the same policy/scene')
        approve(host)
        player.get_by_role('button',name='我准备好了',exact=True).click(); host.get_by_role('button',name='我准备好了',exact=True).click()
        host.get_by_role('button',name='开启故事',exact=True).click()
        expect(player.locator('.status-pill')).to_contain_text('故事进行中')
        tools(host,'房间配置'); expect(host.get_by_role('button',name='导入房间配置',exact=True)).to_be_disabled(); close(host)
        # Image preview/cancel, network failure recovery, caption and authenticated reload.
        player.get_by_label('选择聊天图片文件').set_input_files(str(image))
        expect(player.get_by_alt_text('待发送图片',exact=True)).to_be_visible()
        player.get_by_role('button',name='移除待发送图片',exact=True).click()
        expect(player.get_by_alt_text('待发送图片',exact=True)).to_have_count(0)
        player.get_by_label('选择聊天图片文件').set_input_files(str(image))
        player.get_by_label('公开叙事内容').fill('这张地图标记了码头附近的街区。')
        player.route(re.compile(r'/api/rooms/[^/]+/images$'),lambda route:route.abort())
        player.get_by_role('button',name='发送公开消息',exact=True).click()
        expect(player.get_by_role('alert')).to_contain_text('请求失败')
        expect(player.get_by_alt_text('待发送图片',exact=True)).to_be_visible()
        player.unroute(re.compile(r'/api/rooms/[^/]+/images$'))
        player.get_by_role('button',name='发送公开消息',exact=True).click()
        expect(player.get_by_alt_text('待发送图片',exact=True)).to_have_count(0)
        expect(host.locator('.chat-image img')).to_have_count(1)
        host.wait_for_function("[...document.querySelectorAll('.chat-image img')].every(e=>e.complete && e.naturalWidth===640)")
        expect(host.locator('.chat-text').filter(has_text='这张地图')).to_have_count(1)
        host.get_by_label('选择聊天图片文件').set_input_files(str(image))
        host.get_by_role('button',name='发送公开消息',exact=True).click()
        expect(player.locator('.chat-image img')).to_have_count(2)
        player.reload(wait_until='domcontentloaded')
        expect(player.locator('.chat-image img')).to_have_count(2)
        player.wait_for_function("[...document.querySelectorAll('.chat-image img')].every(e=>e.complete && e.naturalWidth===640)")
        screenshot(player,'07-chat-images-light.png')
        check('Both roles send real images; preview, cancellation, failed-send recovery, captions and reload work')
        # Saved image download is a local blob; member tokens never enter links.
        href=player.get_by_role('link',name='查看原图：测试地图.png',exact=True).first.get_attribute('href')
        assert href.startswith('blob:') and '?' not in href
        with player.expect_download() as d:
            player.get_by_role('link',name='保存图片',exact=True).first.click()
        d.value.save_as(str(out/'downloaded-map.png'))
        assert (out/'downloaded-map.png').read_bytes()==image.read_bytes()
        check('Chat images download as exact original bytes with no credentials in image URLs')
        player.get_by_role('button',name='切换深色模式',exact=True).click()
        for width in [390,320]:
            player.set_viewport_size({'width':width,'height':900})
            player.get_by_role('button',name='圆桌与记录',exact=True).click()
            player.locator('.chat-form').scroll_into_view_if_needed()
            fit(player,f'{width}px image chat fits'); screenshot(player,f'08-chat-{width}-dark.png')
        assert not errors, errors
        check('No uncaught browser errors')
        (out/'report.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2))
        print(f'ALL {len(checks)} checks passed',flush=True)
    except Exception:
        for name,page in [('host',host),('player',player)]:
            try:
                page.screenshot(path=str(out/f'failure-{name}.png'),full_page=True)
                (out/f'failure-{name}.txt').write_text(page.locator('body').inner_text())
            except Exception: pass
        raise
    finally:
        browser.close()
