import json
import time
import pytest
from fastapi.testclient import TestClient
from app.importer import import_pdf
from app.main import create_app
from app.storage import atomic_write,paper_dir,read_json
from app.workspace import JobInput,page_source,read_translation,CodexJobs,strict_schema
from test_api import report_for,env,pdf_bytes


def wait_job(manager, job):
    for _ in range(200):
        value=manager.get(job['job_id'])
        if value['status'] not in {'queued','running'}:return value
        time.sleep(.01)
    raise AssertionError('Job did not finish')


def translator(job,prompt,schema,label):
    data=json.loads(prompt.split('UNTRUSTED_PAGE_DATA:\n')[1])
    return {'segments':[{'id':s['id'],'translation':'测试译文：动作时域为 50；原始数值保留。'} for s in data['segments']]},{'engine':'test-double','auth':'fixture'}


def test_qa_persistence_origin_validation_and_regeneration(env):
    root,meta,client,prefix=env
    payload={'question':'动作时间和生成时间有什么区别？','context':'version v1 / page 1','answer':'【测试用用户粘贴文本】两个时间轴不同。','page':1,'provider':'chatgpt'}
    assert client.post(prefix+'/qa',json=payload,headers={'Origin':'https://evil.example'}).status_code==403
    record=client.post(prefix+'/qa',json=payload)
    assert record.status_code==200 and record.json()['provenance']=='user_pasted'
    from app.reports import publish_report
    publish_report(root,report_for(meta))
    restarted=TestClient(create_app(root))
    assert restarted.get(prefix+'/qa').json()['records'][0]['answer']==payload['answer']
    assert client.post(prefix+'/qa',json=payload|{'page':99}).status_code==422
    assert client.post(prefix+'/qa',json=payload|{'answer':''}).status_code==422


def test_translation_cache_and_schema_and_human_preservation(env):
    root,meta,client,prefix=env
    folder=paper_dir(root,meta.paper_id,meta.version)
    atomic_write(folder/'notes.md','human notes')
    atomic_write(folder/'study.json','{"personal":"keep"}')
    source=page_source(root,meta.paper_id,meta.version,1)
    assert source['segments'] and source['pdf_sha256']==meta.pdf_sha256
    before=(paper_dir(root,meta.paper_id,meta.version,True)/'paper.pdf').read_bytes()
    manager=CodexJobs(root,runner=translator)
    task=manager.submit(meta.paper_id,meta.version,JobInput(kind='translate_page',page=1))
    assert wait_job(manager,task)['status']=='completed'
    result=read_translation(root,meta.paper_id,meta.version,1)
    assert '测试译文' in result['translation']['segments'][0]['translation']
    assert result['translation']['receipt']['engine']=='test-double'
    assert client.get(prefix+'/reading/1').status_code==200
    from app.reports import publish_report
    publish_report(root,report_for(meta))
    assert read_translation(root,meta.paper_id,meta.version,1)['translation']==result['translation']
    assert (folder/'notes.md').read_text()=='human notes'
    assert (folder/'study.json').read_text()=='{"personal":"keep"}'
    assert (paper_dir(root,meta.paper_id,meta.version,True)/'paper.pdf').read_bytes()==before
    manager.pool.shutdown()


def test_bad_translation_no_output_is_published(env):
    root,meta,_,_=env
    def bad(*args):return {'segments':[{'id':'invented','translation':'bad'}]},{}
    manager=CodexJobs(root,runner=bad)
    task=manager.submit(meta.paper_id,meta.version,JobInput(kind='translate_page',page=1))
    assert wait_job(manager,task)['status']=='failed'
    assert read_translation(root,meta.paper_id,meta.version,1)['translation'] is None
    manager.pool.shutdown()


def test_job_analysis_uses_validated_publisher(env):
    root,meta,client,prefix=env
    from app.storage import write_json
    pages_path=paper_dir(root,meta.paper_id,meta.version,True)/'pages.json'
    pages=read_json(pages_path);pages['limited']=False;write_json(pages_path,pages)
    manager=CodexJobs(root,runner=lambda *args:(report_for(meta),{'engine':'test-double'}))
    task=manager.submit(meta.paper_id,meta.version,JobInput(kind='analyze'))
    assert wait_job(manager,task)['status']=='completed'
    assert client.get(prefix+'/report').json()['report']['paper_id']==meta.paper_id
    assert client.post(prefix+'/jobs',json={'kind':'shell','command':'anything'}).status_code==422
    assert client.post(prefix+'/jobs',json={'kind':'translate_page','page':99}).status_code==422
    manager.pool.shutdown()


def test_source_hash_change_and_invalid_page(env):
    root,meta,_,_=env
    with pytest.raises(ValueError):page_source(root,meta.paper_id,meta.version,0)
    pdf=paper_dir(root,meta.paper_id,meta.version,True)/'paper.pdf'
    atomic_write(pdf,b'%PDF-changed')
    with pytest.raises(ValueError):page_source(root,meta.paper_id,meta.version,1)
    schema=strict_schema({'type':'object','properties':{'a':{'type':'string','default':'a'}}})
    assert schema['required']==['a'] and schema['additionalProperties'] is False


def test_cancelled_job_cannot_publish_translation(env):
    import threading
    root,meta,_,_=env
    entered,release=threading.Event(),threading.Event()
    def waiting(*args):
        entered.set();release.wait(5)
        return translator(*args)
    manager=CodexJobs(root,runner=waiting)
    task=manager.submit(meta.paper_id,meta.version,JobInput(kind='translate_page',page=1))
    assert entered.wait(2)
    assert manager.cancel(task['job_id'])['status']=='cancelled'
    release.set();manager.pool.shutdown(wait=True)
    assert manager.get(task['job_id'])['status']=='cancelled'
    assert read_translation(root,meta.paper_id,meta.version,1)['translation'] is None
