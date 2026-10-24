import json
import time
import pytest
from fastapi.testclient import TestClient
from app.importer import import_pdf
from app.main import create_app
from app.storage import atomic_write,paper_dir,read_json
from app.workspace import JobInput,CodexJobs,strict_schema
from test_api import report_for,env,pdf_bytes


def wait_job(manager, job):
    for _ in range(200):
        value=manager.get(job['job_id'])
        if value['status'] not in {'queued','running'}:return value
        time.sleep(.01)
    raise AssertionError('Job did not finish')


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
    # Page / whole-paper translation jobs were removed; the allowlist rejects them.
    assert client.post(prefix+'/jobs',json={'kind':'translate_page','page':1}).status_code==422
    assert client.post(prefix+'/jobs',json={'kind':'translate_all'}).status_code==422
    assert client.get(prefix+'/reading/1').status_code==404
    manager.pool.shutdown()


def test_strict_schema_requires_every_property():
    schema=strict_schema({'type':'object','properties':{'a':{'type':'string','default':'a'}}})
    assert schema['required']==['a'] and schema['additionalProperties'] is False
