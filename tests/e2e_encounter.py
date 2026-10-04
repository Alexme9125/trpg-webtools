"""Real-browser D&D data-block and light encounter assistance acceptance.

Run against the running app with Python Playwright and Chrome/Chromium.
"""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5173')
args = parser.parse_args()
out = Path('test-results/encounter')
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

def fit(page, name):
    g = page.evaluate('''() => ({v:innerWidth,w:document.documentElement.scrollWidth,
        dialogs:[...document.querySelectorAll('.modal,.modal-content,.encounter-detail,.dnd-editor')].map(e=>({w:e.clientWidth,s:e.scrollWidth,r:e.getBoundingClientRect().right}))})''')
    assert g['w'] <= g['v']+1 and all(d['s'] <= d['w']+1 and d['r'] <= g['v']+1 for d in g['dialogs']), (name,g)
    check(name+' fits')

def shot(page, name):
    page.screenshot(path=str(out/name), full_page=False, animations='disabled')

def export_cards(page, filename):
    with page.expect_download() as dl:
        page.get_by_role('button', name='导出全部', exact=True).click()
    path = out/filename
    dl.value.save_as(str(path))
    return json.loads(path.read_text())['cards']

def choose(page, rule):
    page.goto(args.url, wait_until='domcontentloaded')
    page.locator(f'.rule-card.{rule} .rule-choose').click()

def room(page, rule, title):
    choose(page,rule)
    page.get_by_label('你的称呼').fill('测试主持人')
    page.get_by_label('房间名称').fill(title)
    page.get_by_role('button',name='创建房间，成为主持人').click()
    expect(page.locator('.room-title h1')).to_have_text(title)
    return page.locator('.room-code b').inner_text()

def join(page, rule, code, name):
    choose(page,rule)
    page.get_by_role('button',name='加入房间',exact=True).first.click()
    page.get_by_label('你的称呼').fill(name)
    page.get_by_label('房间码',exact=True).fill(code)
    page.locator('form').get_by_role('button',name='加入房间',exact=True).click()
    expect(page.locator('.room-title h1')).to_be_visible()

def prepare(page, rule, name):
    page.get_by_role('button',name='创建角色',exact=True).click()
    page.get_by_label('角色姓名').fill(name)
    page.get_by_role('dialog').locator('select').first.select_option('游侠' if rule=='dnd' else '记者')
    if rule=='dnd':
        page.get_by_label('种族',exact=True).fill('半精灵')
        page.get_by_role('button',name='属性与状态',exact=True).click()
        page.get_by_label('生命上限',exact=True).fill('12')
        page.get_by_label('当前生命',exact=True).fill('12')
    page.get_by_role('button',name='技能与熟练',exact=True).click()
    if rule=='dnd':
        page.get_by_role('button',name='建议分配',exact=True).click()
    else:
        page.get_by_label('信用评级职业点',exact=True).fill('9')
    page.get_by_role('button',name='保存并提交审核',exact=True).click()
    expect(page.get_by_role('dialog')).to_have_count(0)

def start(host,player):
    player.get_by_role('button',name='我准备好了',exact=True).click()
    host.get_by_role('button',name='我准备好了',exact=True).click()
    host.get_by_role('button',name=re.compile('审核与制卡要求')).click()
    host.get_by_role('button',name='通过此卡',exact=True).click()
    close(host)
    host.get_by_role('button',name='开启故事',exact=True).click()
    expect(player.locator('.status-pill')).to_contain_text('故事进行中')

def encounter(page):
    page.get_by_role('button',name='场景与回合',exact=True).click()
    page.get_by_role('button',name=re.compile('^行动与状态')).click()
    expect(page.locator('.encounter-panel')).to_be_visible()

def save_instance(page):
    page.get_by_role('button',name='保存本场记录',exact=True).click()
    expect(page.get_by_role('button',name='保存本场记录',exact=True)).to_be_disabled()

def select_instance(page,name):
    page.locator('.encounter-roster').get_by_role('button',name=re.compile(re.escape(name))).click()
    expect(page.locator('.combatant-heading h3')).to_have_text(name)

with sync_playwright() as p:
    chrome=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    browser=p.chromium.launch(headless=True, **({'executable_path':str(chrome)} if chrome.exists() else {}))
    contexts=[]
    def new_page():
        context=browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True,permissions=['clipboard-read','clipboard-write'])
        contexts.append(context)
        page=context.new_page()
        page.set_default_timeout(10000)
        page.on('pageerror',lambda e: errors.append(str(e)))
        return page
    host,player=new_page(),new_page()
    pages=[host,player]
    try:
        host.goto(args.url,wait_until='domcontentloaded')
        nav(host,'主持人工具集')
        host.get_by_role('button',name='D&D 5e · 2014',exact=True).click()
        host.get_by_role('button',name='打开个人数据块库',exact=True).click()
        host.get_by_label('从模板开始').select_option('npc-bridge-guard')
        host.get_by_role('button',name='使用此模板',exact=True).click()
        host.get_by_label('数据块名称',exact=True).fill('夜桥守卫')
        expect(host.get_by_label('当前 HP',exact=True)).to_have_value('')
        host.get_by_label('主持人笔记与待核对项',exact=True).fill('秘密：铜门的钥匙在北塔。')
        host.get_by_role('button',name='行动与能力',exact=True).click()
        host.get_by_label('动作 1 可用次数',exact=True).fill('3')
        host.get_by_label('动作 1 恢复条件',exact=True).fill('休息后恢复')
        host.get_by_role('button',name='保存数据块',exact=True).click()
        expect(host.locator('.keeper-card-list > button')).to_have_count(1)
        originals=export_cards(host,'dnd-personal.json')
        assert originals[0]['hp'] is None and originals[0]['maxHp']==19
        with host.expect_download() as dl:
            host.get_by_role('button',name='Markdown',exact=True).click()
        md=out/'single-dnd.md'
        dl.value.save_as(str(md))
        host.get_by_label('导入 D&D 资料集文件',exact=True).set_input_files(str(md.resolve()))
        expect(host.locator('.keeper-card-list > button')).to_have_count(2)
        check('D&D personal creation before entry, unknown HP preservation, Markdown round trip without overwriting')
        close(host)
        host.get_by_role('button',name='提取提示词、模板与教程',exact=True).click()
        host.get_by_role('button',name='复制 LLM 提取提示词',exact=True).click()
        expect(host.get_by_role('button',name='提示词已复制',exact=True)).to_be_visible()
        prompt=host.evaluate('navigator.clipboard.readText()')
        assert 'dnd-source' in prompt and '2014' in prompt
        for button,filename,marker in [('下载 Markdown 模板','dnd-import.md','dnd-source'),('下载文字教程','dnd-guide.md','场景与回合')]:
            with host.expect_download() as dl:
                host.get_by_role('button',name=button,exact=True).click()
            path=out/filename
            dl.value.save_as(str(path))
            assert marker in path.read_text()
        host.get_by_role('button',name='打开个人数据块库',exact=True).click()
        host.get_by_label('导入 D&D 资料集文件',exact=True).set_input_files(str((out/'dnd-import.md').resolve()))
        expect(host.locator('.keeper-card-list > button')).to_have_count(4)
        close(host)
        host.reload(wait_until='domcontentloaded')
        nav(host,'主持人工具集')
        host.get_by_role('button',name='D&D 5e · 2014',exact=True).click()
        host.get_by_role('button',name='打开个人数据块库',exact=True).click()
        expect(host.locator('.keeper-card-list > button')).to_have_count(4)
        close(host)
        check('D&D prompt copied, real template imported, tutorial downloaded and IndexedDB survived refresh')
        shot(host,'01-dnd-toolkit-light.png')
        host.get_by_role('button',name='切换深色模式',exact=True).click()
        shot(host,'02-dnd-toolkit-dark.png')
        for width in [390,320]:
            host.set_viewport_size({'width':width,'height':844})
            fit(host,f'D&D toolkit {width}')
            host.get_by_role('button',name='打开个人数据块库',exact=True).click()
            host.locator('.keeper-card-list > button').filter(has_text='夜桥守卫').first.click()
            for tab in ['身份与防御','属性与感知','行动与能力','数据块预览']:
                host.get_by_role('button',name=tab,exact=True).click()
                fit(host,f'D&D {tab} {width}')
            shot(host,f'03-dnd-preview-{width}.png')
            close(host)
        host.set_viewport_size({'width':1440,'height':1050})
        host.get_by_role('button',name='切换浅色模式',exact=True).click()
        nav(host,'入席')
        host.locator('.rule-card.dnd .rule-choose').click()
        host.get_by_label('你的称呼').fill('夜桥 DM')
        host.get_by_label('房间名称').fill('夜桥战斗验收')
        host.get_by_role('button',name='创建房间，成为主持人').click()
        expect(host.locator('.room-title h1')).to_have_text('夜桥战斗验收')
        code=host.locator('.room-code b').inner_text()
        expect(host.get_by_role('button',name='主持人工具',exact=True)).to_have_count(0)
        expect(host.get_by_role('button',name='场景与回合',exact=True)).to_be_visible()
        nav(host,'主持人工具集')
        host.get_by_role('button',name='打开个人数据块库',exact=True).click()
        host.locator('.keeper-card-list > button').filter(has_text='夜桥守卫').first.click()
        host.get_by_role('button',name='带入当前房间',exact=True).click()
        expect(host.locator('.keeper-success')).to_contain_text('独立副本')
        close(host)
        host.get_by_role('button',name=re.compile('房间 D&D 数据块库')).click()
        transferred=export_cards(host,'dnd-room.json')
        assert len(transferred)==1 and transferred[0]['id']!=originals[0]['id']
        close(host)
        host.get_by_role('main').get_by_role('button',name='返回房间',exact=True).click()
        join(player,'dnd',code,'弓手')
        prepare(player,'dnd','旅人')
        start(host,player)
        encounter(host)
        host.get_by_label('个体数量',exact=True).fill('2')
        host.get_by_role('button',name='加入参战',exact=True).click()
        expect(host.locator('.encounter-row')).to_have_count(3)
        select_instance(host,'夜桥守卫 · 1')
        expect(host.get_by_label('当前 HP',exact=True)).to_have_value('')
        host.get_by_role('button',name='将当前 HP 填为上限',exact=True).click()
        host.get_by_label('公开显示名称',exact=True).fill('桥头守卫')
        host.get_by_label('向玩家公开名称、行动顺序与状态',exact=True).check()
        host.get_by_label('手填行动值',exact=True).fill('50')
        host.get_by_label('短矛剩余次数',exact=True).fill('1')
        host.get_by_role('button',name='倒地',exact=True).click()
        save_instance(host)
        select_instance(host,'夜桥守卫 · 2')
        expect(host.get_by_label('当前 HP',exact=True)).to_have_value('')
        expect(host.get_by_label('短矛剩余次数',exact=True)).to_have_value('3')
        expect(host.get_by_label('向玩家公开名称、行动顺序与状态',exact=True)).not_to_be_checked()
        host.get_by_role('button',name='生成顺序',exact=True).click()
        expect(host.locator('.encounter-row.current')).to_contain_text('夜桥守卫 · 1')
        expect(host.locator('.encounter-row.current .encounter-order')).to_have_text('50')
        player.get_by_role('button',name='本场战斗',exact=True).click()
        expect(player.locator('.encounter-row')).to_have_count(2)
        expect(player.get_by_role('dialog')).not_to_contain_text('夜桥守卫')
        expect(player.get_by_role('dialog')).not_to_contain_text('铜门')
        player.locator('.encounter-row').filter(has_text='桥头守卫').click()
        expect(player.locator('.encounter-public')).to_contain_text('倒地')
        expect(player.locator('.encounter-public')).not_to_contain_text('HP')
        close(player)
        check('Room copies, two independent instances, manual initiative and public alias/condition privacy')
        select_instance(host,'旅人')
        host.get_by_label('当前 HP',exact=True).fill('9')
        save_instance(host)
        expect(player.locator('.resource-control').first.locator('b')).to_have_text('9/12')
        player.get_by_role('button',name='减少生命',exact=True).click()
        expect(host.get_by_label('当前 HP',exact=True)).to_have_value('8')
        # Concurrent character changes must not overwrite a host draft.
        host.get_by_label('当前 HP',exact=True).fill('7')
        player.get_by_role('button',name='减少生命',exact=True).click()
        expect(host.get_by_role('button',name='保存本场记录',exact=True)).to_be_disabled()
        host.get_by_role('button',name='重新载入最新记录',exact=True).click()
        expect(host.get_by_label('当前 HP',exact=True)).to_have_value('7')
        check('Player HP synchronizes both ways; concurrent changes require reloading the stale host draft')
        select_instance(host,'夜桥守卫 · 1')
        host.get_by_label('当前 HP',exact=True).fill('0')
        host.get_by_label('正在专注的法术',exact=True).fill('雾云术')
        save_instance(host)
        host.get_by_role('button',name='掷死亡豁免',exact=True).click()
        expect(host.locator('.combatant-roll-result')).to_contain_text('PRIVATE ROLL')
        expect(host.get_by_label('死亡豁免成功',exact=True)).to_have_value('0')
        expect(host.get_by_label('死亡豁免失败',exact=True)).to_have_value('0')
        host.get_by_role('button',name='确认记录此结果',exact=True).click()
        expect(host.get_by_role('button',name='结果已记录',exact=True)).to_be_disabled()
        assert int(host.get_by_label('当前 HP',exact=True).input_value()) + int(host.get_by_label('死亡豁免成功',exact=True).input_value()) + int(host.get_by_label('死亡豁免失败',exact=True).input_value()) > 0
        # Force a failing save using a legal DC, so confirmation can be observed deterministically.
        host.get_by_label('此次受到的伤害',exact=True).fill('1000')
        host.get_by_role('button',name='检定专注',exact=True).click()
        expect(host.get_by_role('button',name='确认结束专注',exact=True)).to_be_visible()
        expect(host.get_by_label('正在专注的法术',exact=True)).to_have_value('雾云术')
        host.get_by_role('button',name='确认结束专注',exact=True).click()
        expect(host.get_by_label('正在专注的法术',exact=True)).to_have_value('')
        expect(player.locator('.private-label')).to_have_count(0)
        hp=host.get_by_label('当前 HP',exact=True).input_value()
        host.get_by_label('战斗掷骰可见范围',exact=True).select_option('public')
        host.get_by_role('button',name='短矛 +3',exact=True).click()
        host.get_by_role('button',name='攻击检定',exact=True).click()
        expect(player.locator('.roll-event')).to_have_count(1)
        host.get_by_label('伤害或其他骰式',exact=True).fill('2d6+3')
        host.get_by_role('button',name='掷骰',exact=True).click()
        expect(player.locator('.roll-event')).to_have_count(2)
        expect(host.get_by_label('当前 HP',exact=True)).to_have_value(hp)
        check('Server dice, private/public visibility, death-save and concentration effects require explicit confirmation')
        for width in [1440,390,320]:
            host.set_viewport_size({'width':width,'height':1050 if width==1440 else 844})
            fit(host,f'Encounter {width}')
            host.get_by_label('当前 HP',exact=True).scroll_into_view_if_needed()
            shot(host,f'04-encounter-{width}.png')
            host.get_by_label('新增资源名称',exact=True).fill(f'战技骰 {width}')
            host.locator('.combatant-counters .combatant-custom-condition').get_by_role('button',name='添加',exact=True).click()
            save_instance(host)
        close(host)
        host.set_viewport_size({'width':1440,'height':1050})
        host.get_by_role('button',name='切换深色模式',exact=True).click()
        encounter(host)
        select_instance(host,'夜桥守卫 · 1')
        host.get_by_label('当前 HP',exact=True).scroll_into_view_if_needed()
        fit(host,'Dark encounter 1440')
        shot(host,'04-encounter-dark.png')
        close(host)
        host.get_by_role('button',name='切换浅色模式',exact=True).click()
        host.reload(wait_until='domcontentloaded')
        expect(host.locator('.room-title h1')).to_have_text('夜桥战斗验收')
        encounter(host)
        select_instance(host,'夜桥守卫 · 1')
        expect(host.get_by_label('短矛剩余次数',exact=True)).to_have_value('1')
        expect(host.get_by_label('正在专注的法术',exact=True)).to_have_value('')
        close(host)
        nav(host,'主持人工具集')
        host.get_by_role('button',name=re.compile('房间 D&D 数据块库')).click()
        after=export_cards(host,'dnd-template-after-encounter.json')
        assert after==transferred
        close(host)
        check('Encounter progress survives reconnect; individual edits never alter the room source template')
        # CoC keeps its own schema and combat semantics.
        kp,investigator=new_page(),new_page()
        pages += [kp,investigator]
        coccode=room(kp,'coc','码头对抗验收')
        nav(kp,'主持人工具集')
        kp.get_by_role('button',name=re.compile('房间 NPC 与怪物卡库')).click()
        kp.get_by_label('导入KP资料文件',exact=True).set_input_files(str(Path('docs/templates/keeper-import.md').resolve()))
        expect(kp.locator('.keeper-card-list > button')).to_have_count(2)
        close(kp)
        kp.get_by_role('main').get_by_role('button',name='返回房间',exact=True).click()
        join(investigator,'coc',coccode,'调查员')
        prepare(investigator,'coc','记者')
        start(kp,investigator)
        encounter(kp)
        kp.get_by_label('个体数量',exact=True).fill('2')
        kp.get_by_role('button',name='加入参战',exact=True).click()
        expect(kp.locator('.encounter-row')).to_have_count(3)
        names=kp.locator('.encounter-row-name b').all_text_contents()
        npc=next(n for n in names if ' · 1' in n)
        select_instance(kp,npc)
        dex=int(kp.get_by_label('敏捷 DEX',exact=True).input_value())
        kp.get_by_label('枪械已准备好（行动排序 DEX＋50）',exact=True).check()
        kp.get_by_label('重伤',exact=True).check()
        kp.get_by_label('濒死',exact=True).check()
        save_instance(kp)
        kp.get_by_role('button',name='生成顺序',exact=True).click()
        expect(kp.locator('.encounter-row').filter(has_text=npc).locator('.encounter-order')).to_have_text(str(dex+50))
        kp.get_by_label('进攻者').select_option(label=npc)
        kp.get_by_label('防守者').select_option(label='记者')
        kp.get_by_label('进攻技能百分比',exact=True).fill('60')
        kp.get_by_label('防守技能百分比',exact=True).fill('45')
        coc_hp=kp.get_by_label('当前 HP',exact=True).input_value()
        kp.get_by_role('button',name='掷骰并比较',exact=True).click()
        expect(kp.locator('.coc-melee-result')).to_contain_text('不自动扣除 HP')
        expect(investigator.locator('.roll-event')).to_have_count(0)
        kp.get_by_label('防守方式').select_option('fight-back')
        kp.get_by_label('近战对抗可见范围',exact=True).select_option('public')
        kp.get_by_role('button',name='掷骰并比较',exact=True).click()
        expect(investigator.locator('.system-event').last).to_contain_text('不自动扣除 HP')
        expect(kp.get_by_label('当前 HP',exact=True)).to_have_value(coc_hp)
        expect(kp.get_by_label('重伤',exact=True)).to_be_checked()
        check('CoC firearm initiative, injury flags and private/public dodge/fight-back comparisons preserve HP')
        for width in [390,320]:
            kp.set_viewport_size({'width':width,'height':844})
            kp.get_by_role('button',name='掷骰并比较',exact=True).scroll_into_view_if_needed()
            fit(kp,f'CoC opposed roll {width}')
            shot(kp,f'05-coc-opposed-{width}.png')
        assert not errors,errors
        check('No browser runtime errors')
    except Exception:
        for i,page in enumerate(pages):
            try:
                shot(page,f'failure-{i}.png')
                (out/f'failure-{i}.txt').write_text(page.locator('body').inner_text())
            except Exception:
                pass
        raise
    finally:
        (out/'acceptance.json').write_text(json.dumps({'checks':checks,'browserErrors':errors},ensure_ascii=False,indent=2))
        browser.close()
    print(f'Completed {len(checks)} encounter checks.',flush=True)
