"""Personal keeper library, source imports, layout and floating budget acceptance."""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5173')
args = parser.parse_args()
out = Path('test-results/toolkit')
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
def shot(page, name):
    page.wait_for_function("[...document.querySelectorAll('.page-enter')].filter(e=>e.getClientRects().length).every(e=>Number(getComputedStyle(e).opacity)>=0.99)")
    page.screenshot(path=str(out/name), full_page=False, animations='disabled')
def fit(page, name):
    geometry=page.evaluate('''() => ({v:innerWidth,w:document.documentElement.scrollWidth,dialogs:[...document.querySelectorAll('.modal')].map(e=>({w:e.clientWidth,s:e.scrollWidth,r:e.getBoundingClientRect().right,b:e.getBoundingClientRect().bottom}))})''')
    assert geometry['w'] <= geometry['v']+1, (name,geometry)
    assert all(d['s'] <= d['w']+1 and d['r'] <= geometry['v']+1 for d in geometry['dialogs']), (name,geometry)
    check(name+' fits')
def export_all(page, filename):
    with page.expect_download() as download:
        page.get_by_role('button', name='导出全部', exact=True).click()
    path=out/filename
    download.value.save_as(str(path))
    return json.loads(path.read_text())['cards']

with sync_playwright() as p:
    chrome=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    browser=p.chromium.launch(headless=True, **({'executable_path':str(chrome)} if chrome.exists() else {}))
    context=browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True,permissions=['clipboard-read','clipboard-write'])
    outsider_context=browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True)
    host, player=context.new_page(), outsider_context.new_page()
    for page in [host,player]:
        page.set_default_timeout(10000)
        page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        host.goto(args.url,wait_until='domcontentloaded')
        nav(host,'主持人工具集')
        expect(host.get_by_role('heading',name='主持人工具集',exact=True)).to_be_visible()
        host.get_by_role('button',name='打开个人卡库',exact=True).click()
        expect(host.get_by_role('dialog')).to_be_visible()
        host.get_by_role('button',name='新建 NPC',exact=True).click()
        host.get_by_label('资料卡名称').fill('入席前的灯塔守卫')
        host.get_by_label('私密笔记',exact=True).fill('个人原稿：守卫保管灯塔钥匙。')
        host.get_by_role('button',name='保存资料卡',exact=True).click()
        expect(host.locator('.keeper-card-list > button')).to_have_count(1)
        close(host)
        check('Create and save a personal NPC before creating or joining any room')
        host.get_by_role('button',name='提取提示词、模板与教程',exact=True).click()
        host.get_by_role('button',name='复制 LLM 提取提示词',exact=True).click()
        expect(host.get_by_role('button',name='提示词已复制',exact=True)).to_be_visible()
        prompt=host.evaluate('navigator.clipboard.readText()')
        assert 'keeper-source' in prompt and '不要根据一个固定值反推骰式' in prompt
        for button, filename in [('下载 Markdown 模板','template.md'),('下载文字教程','guide.md'),('下载提示词','prompt.md')]:
            with host.expect_download() as download:
                host.get_by_role('button',name=button,exact=True).click()
            download.value.save_as(str(out/filename))
        assert 'keeper-source' in (out/'template.md').read_text()
        assert '主持人工具集' in (out/'guide.md').read_text()
        assert (out/'prompt.md').read_text() == prompt
        shot(host,'01-import-guide.png')
        check('Copy the complete LLM prompt and download the template, prompt and written tutorial')
        host.get_by_role('button',name='打开个人卡库',exact=True).click()
        expect(host.get_by_role('dialog')).to_be_visible()
        host.get_by_label('导入KP资料文件').set_input_files(str((out/'template.md').resolve()))
        expect(host.locator('.keeper-card-list > button')).to_have_count(3)
        cards=export_all(host,'personal-original.json')
        original=next(c for c in cards if c['name']=='入席前的灯塔守卫')
        monster=next(c for c in cards if c['name']=='钟室回声兽')
        assert monster['maxHp']==27 and monster['hp'] is None and monster['attacksPerRound'] is None
        assert monster['attributeRolls']['str']=='(2d6+13)*5'
        close(host)
        host.reload(wait_until='domcontentloaded')
        nav(host,'主持人工具集')
        host.get_by_role('button',name='打开个人卡库',exact=True).click()
        expect(host.get_by_role('dialog')).to_be_visible()
        expect(host.locator('.keeper-card-list > button')).to_have_count(3)
        close(host)
        shot(host,'02-toolkit-desktop-light.png')
        check('The actual Markdown template imports; original HP, formulas and unknown values survive refresh')
        # Separate browser profiles never share a private personal library.
        player.goto(args.url,wait_until='domcontentloaded')
        nav(player,'主持人工具集')
        player.get_by_role('button',name='打开个人卡库',exact=True).click()
        expect(player.get_by_role('dialog')).to_be_visible()
        expect(player.locator('.keeper-card-list > button')).to_have_count(0)
        close(player)
        check('Personal cards are isolated from another browser profile')
        # Create a room and explicitly bring copies from the personal library.
        nav(host,'入席')
        host.locator('.rule-card.coc .rule-choose').click()
        host.get_by_label('你的称呼').fill('备团 KP')
        host.get_by_label('房间名称').fill('灯塔的备团夜')
        host.get_by_role('button',name='创建房间，成为主持人').click()
        expect(host.locator('.room-title h1')).to_have_text('灯塔的备团夜')
        code=host.locator('.room-code b').inner_text()
        inset=host.evaluate('''()=>{const p=document.querySelector('.party-panel').getBoundingClientRect(),b=document.querySelector('.host-workbench .button').getBoundingClientRect();return {left:b.left-p.left,right:p.right-b.right}}''')
        assert inset['left']>=18 and inset['right']>=18,inset
        check('The host workbench has consistent inset from both panel edges')
        nav(host,'主持人工具集')
        host.get_by_role('button',name='打开个人卡库',exact=True).click()
        expect(host.get_by_role('dialog')).to_be_visible()
        host.get_by_role('button',name='全部带入房间',exact=True).click()
        expect(host.locator('.keeper-success')).to_contain_text('3 张')
        close(host)
        host.get_by_role('button',name=re.compile('房间 NPC 与怪物卡库')).click()
        expect(host.locator('.keeper-card-list > button')).to_have_count(3)
        room_cards=export_all(host,'room-copies.json')
        assert {c['id'] for c in cards}.isdisjoint({c['id'] for c in room_cards})
        host.locator('.keeper-card-list > button').filter(has_text='入席前的灯塔守卫').click()
        host.get_by_label('私密笔记',exact=True).fill('本团变化：守卫已交出钥匙。')
        host.get_by_role('button',name='保存资料卡',exact=True).click()
        host.get_by_role('button',name='存入个人备团库',exact=True).click()
        expect(host.locator('.keeper-success')).to_contain_text('独立副本')
        close(host)
        host.get_by_role('button',name='打开个人卡库',exact=True).click()
        expect(host.get_by_role('dialog')).to_be_visible()
        expect(host.locator('.keeper-card-list > button')).to_have_count(4)
        revised=export_all(host,'personal-after-room.json')
        assert next(c for c in revised if c['id']==original['id'])['notes']==original['notes']
        assert any('本团变化' in c['notes'] for c in revised)
        close(host)
        check('Explicit room transfer uses independent IDs; room edits preserve originals and copy back')
        host.get_by_role('button',name='切换深色模式',exact=True).click()
        shot(host,'03-toolkit-desktop-dark.png')
        for width in [390,320]:
            host.set_viewport_size({'width':width,'height':844})
            fit(host,f'Host toolkit {width}')
            host.get_by_role('button',name='打开个人卡库',exact=True).click()
            expect(host.get_by_role('dialog')).to_be_visible()
            host.locator('.keeper-card-list > button').filter(has_text='钟室回声兽').click()
            fit(host,f'Personal editor {width}')
            shot(host,f'04-personal-mobile-{width}.png')
            close(host)
        host.set_viewport_size({'width':1440,'height':1050})
        # CoC allocation remains readable during long scrolls and updates in place.
        nav(player,'入席')
        player.locator('.rule-card.coc .rule-choose').click()
        player.get_by_role('button',name='加入房间',exact=True).first.click()
        player.get_by_label('你的称呼').fill('调查员')
        player.get_by_label('房间码',exact=True).fill(code)
        player.locator('form').get_by_role('button',name='加入房间',exact=True).click()
        expect(player.locator('.room-title h1')).to_have_text('灯塔的备团夜')
        player.get_by_role('button',name='创建角色',exact=True).click()
        player.get_by_label('角色姓名').fill('洛温')
        player.get_by_role('dialog').locator('select').first.select_option('记者')
        player.get_by_role('button',name='属性与状态',exact=True).click()
        player.get_by_label('智力属性',exact=True).fill('60')
        player.get_by_role('button',name='技能与熟练',exact=True).click()
        expect(player.locator('.budget-follow')).not_to_have_class(re.compile('is-visible'))
        for width in [1440,390,320]:
            player.set_viewport_size({'width':width,'height':1050 if width==1440 else 844})
            player.get_by_label('追踪兴趣点',exact=True).fill('20')
            expect(player.locator('.budget-follow')).to_have_class(re.compile('is-visible'))
            expect(player.locator('.budget-float')).to_contain_text('100')
            player.get_by_label('追踪兴趣点',exact=True).fill('25')
            expect(player.locator('.budget-float')).to_contain_text('95')
            box=player.locator('.budget-float').bounding_box()
            modal=player.get_by_role('dialog').bounding_box()
            assert box['y']>=modal['y'] and box['y']+box['height']<=modal['y']+modal['height'],(box,modal)
            fit(player,f'Floating CoC budget {width}')
            shot(player,f'05-budget-{width}.png')
            player.get_by_role('button',name='返回点数总览',exact=True).click()
            expect(player.locator('.budget-follow')).not_to_have_class(re.compile('is-visible'))
        close(player)
        check('CoC budget follows only after scrolling out, updates live and returns to overview')
        # D&D skill chips keep each label on one line at narrow widths too.
        player.set_viewport_size({'width':1440,'height':1050})
        nav(player,'角色档案')
        player.get_by_role('button',name='新建角色',exact=True).click()
        player.locator('.new-character-option.dnd').click()
        player.get_by_label('角色姓名').fill('横向熟练测试')
        player.get_by_role('dialog').locator('select').first.select_option('游侠')
        player.get_by_role('button',name='技能与熟练',exact=True).click()
        for width in [1440,390,320]:
            player.set_viewport_size({'width':width,'height':1050 if width==1440 else 844})
            expect(player.locator('.proficiency-choices label').first).to_be_visible()
            layout=player.locator('.proficiency-choices label > span').evaluate_all('''els=>els.map(e=>{const r=document.createRange();r.selectNodeContents(e);return {text:e.textContent,lines:r.getClientRects().length,width:e.getBoundingClientRect().width}})''')
            assert all(entry['lines']==1 for entry in layout),layout
            fit(player,f'DND proficiency labels {width}')
            shot(player,f'06-dnd-labels-{width}.png')
        close(player)
        check('Every DND proficiency name remains on one horizontal line')
        assert not errors,errors
        check('No browser runtime errors in all new workflows')
    except Exception:
        for name,page in [('host',host),('player',player)]:
            try:
                page.screenshot(path=str(out/f'failure-{name}.png'))
                (out/f'failure-{name}.txt').write_text(page.locator('body').inner_text())
            except Exception:
                pass
        raise
    finally:
        (out/'acceptance.json').write_text(json.dumps({'checks':checks,'browserErrors':errors},ensure_ascii=False,indent=2))
        browser.close()
    print(f'Completed {len(checks)} toolkit checks.',flush=True)
