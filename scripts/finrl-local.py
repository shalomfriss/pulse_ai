import os
import subprocess
import threading
from pathlib import Path
from flask import Flask, jsonify, request, render_template_string
from flask_cors import CORS

ROOT = Path(__file__).resolve().parent.parent
FINRL = ROOT / "vendor" / "FinRL"
PYTHON = ROOT / ".venv-finrl" / "bin" / "python"
PORT = int(os.environ.get("FINRL_PORT", "7072"))

app = Flask(__name__)
CORS(app)
jobs = {}
lock = threading.Lock()

WORKFLOWS = {
    "data": {"label": "1 · Download & prepare data", "script": "examples/FinRL_StockTrading_2026_1_data.py", "description": "Downloads the DOW 30 sample from Yahoo Finance, adds technical indicators, VIX, and turbulence, then writes train_data.csv and trade_data.csv."},
    "train": {"label": "2 · Train DRL agents", "script": "examples/FinRL_StockTrading_2026_2_train.py", "description": "Trains A2C, DDPG, PPO, TD3, and SAC agents with Stable-Baselines3 and saves checkpoints under trained_models/."},
    "backtest": {"label": "3 · Backtest & compare", "script": "examples/FinRL_StockTrading_2026_3_Backtest.py", "description": "Requires all five trained_models/agent_*.zip checkpoints. Runs trained agents on the trading period and compares them with MVO and DJIA baselines; if Yahoo rate-limits ^DJI, it uses a local equal-weight benchmark."},
}

PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FinRL Local Workbench</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#172016;background:#f4f3ed}*{box-sizing:border-box}body{margin:0}.wrap{max-width:1180px;margin:auto;padding:32px 28px 70px}.mast{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #c9cbc1;padding-bottom:22px}.eyebrow{font:800 11px ui-monospace,monospace;letter-spacing:.14em;color:#52752d}.mast h1{font-size:clamp(36px,6vw,70px);line-height:.95;letter-spacing:-.07em;margin:14px 0 16px}.mast h1 em{color:#477523;font-style:normal}.mast p{max-width:700px;color:#667064;line-height:1.6}.repo{color:#172016;font:800 11px ui-monospace,monospace;letter-spacing:.08em}.badge{padding:10px 12px;background:#d5f36b;font:800 10px ui-monospace,monospace;white-space:nowrap}.intro{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:28px 0}.card{background:#fff;border:1px solid #c9cbc1;padding:24px}.card h2{font-size:21px;margin:0 0 12px}.card p,.card li{font-size:13px;line-height:1.6;color:#667064}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.step{padding:18px;background:#e8eadf;border-top:3px solid #52752d}.step b{display:block;font:800 11px ui-monospace,monospace;letter-spacing:.08em;margin-bottom:8px}.step span{font-size:13px;line-height:1.5}.controls{margin-top:26px}.controls select,.controls button{font:700 12px ui-monospace,monospace;padding:13px 15px;border:1px solid #172016;background:#fff}.controls button{background:#172016;color:#fff;cursor:pointer;margin-left:8px}.controls button:disabled{opacity:.5}.desc{color:#667064;font-size:13px;line-height:1.5;margin:14px 0}.status{margin-top:14px;padding:14px;background:#172016;color:#d5f36b;font:12px ui-monospace,monospace;white-space:pre-wrap;min-height:54px}.notes{margin-top:22px;color:#667064;font-size:12px;line-height:1.6}.notes strong{color:#172016}@media(max-width:760px){.mast{display:block}.badge{display:inline-block;margin-top:18px}.intro,.steps{grid-template-columns:1fr}}
</style></head><body><main class="wrap"><header class="mast"><div><div class="eyebrow">FINRL / LOCAL RESEARCH WORKBENCH</div><h1>Teach agents<br><em>to trade.</em></h1><p>FinRL is an open-source financial reinforcement-learning framework. This local workbench exposes the official data → train → backtest pipeline from the repository, with every command running inside this project’s isolated Python environment.</p><a class="repo" href="https://github.com/AI4Finance-Foundation/FinRL" target="_blank" rel="noreferrer">VIEW FINRL ON GITHUB ↗</a></div><div class="badge">LOCAL SERVICE · PORT {{port}}</div></header>
<section class="intro"><article class="card"><h2>What FinRL does</h2><p>An RL agent interacts with a market environment, observes prices and technical indicators, chooses actions, and learns a policy from rewards. The classic FinRL workflow is designed for education, experiments, and research—not unattended live trading.</p><ul><li>Market data processors and technical indicators</li><li>Stock, crypto, and portfolio environments</li><li>A2C, DDPG, PPO, SAC, and TD3 agents</li><li>Backtests with baseline comparisons</li></ul></article><article class="card"><h2>Before you start</h2><p>Training can take a long time and uses CPU/GPU resources. Start with the data step, inspect the generated CSVs, then train. Keep credentials out of notebooks and use paper accounts only when you intentionally move to execution.</p><div class="notes"><strong>Repository:</strong> vendor/FinRL<br><strong>Python environment:</strong> .venv-finrl<br><strong>Artifacts:</strong> vendor/FinRL/trained_models and backtest outputs</div></article></section>
<section class="steps"><div class="step"><b>01 · DATA</b><span>Download and preprocess a reproducible market dataset.</span></div><div class="step"><b>02 · TRAIN</b><span>Fit several deep-RL agents on the training period.</span></div><div class="step"><b>03 · BACKTEST</b><span>Evaluate out of sample against simple baselines.</span></div></section>
<section class="card controls"><h2>Run an official FinRL workflow step</h2><select id="workflow"></select><button id="run">START JOB</button><p id="description" class="desc"></p><div id="status" class="status">Ready. Jobs run locally and remain isolated from Pulse order execution.</div></section>
<section class="card notes"><strong>Step-by-step instructions</strong><ol><li>Select <b>Download & prepare data</b> and start the job. Wait for it to finish before continuing.</li><li>Confirm the generated training and trading CSV files in vendor/FinRL.</li><li>Select <b>Train DRL agents</b>. This creates agent checkpoints in trained_models/.</li><li>Select <b>Backtest & compare</b> to evaluate the saved agents against MVO and DJIA.</li><li>Review the printed metrics and generated chart before changing parameters or using another dataset.</li></ol><strong>Safety:</strong> these workflows produce research artifacts only. They do not submit trades.</section></main><script>
const select=document.querySelector('#workflow'),desc=document.querySelector('#description'),status=document.querySelector('#status'),button=document.querySelector('#run');let workflows={};
async function init(){workflows=await (await fetch('/api/workflows')).json();Object.entries(workflows).forEach(([key,item])=>{const option=document.createElement('option');option.value=key;option.textContent=item.label;select.append(option)});update()}
function update(){desc.textContent=workflows[select.value]?.description||''}select.addEventListener('change',update);
button.addEventListener('click',async()=>{button.disabled=true;status.textContent='Starting…';const response=await fetch('/api/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workflow:select.value})});const result=await response.json();if(!response.ok){status.textContent=result.error||'Could not start job';button.disabled=false;return}status.textContent='Job '+result.id+' started. Polling…';const timer=setInterval(async()=>{const current=await (await fetch('/api/jobs/'+result.id)).json();status.textContent=current.output||current.status;if(current.status!=='running'){clearInterval(timer);button.disabled=false}},1500)});init();
</script></body></html>"""

@app.get("/")
def index():
    return render_template_string(PAGE, port=PORT)

@app.get("/api/workflows")
def workflows():
    return jsonify(WORKFLOWS)

@app.post("/api/run")
def run_workflow():
    key = (request.get_json(silent=True) or {}).get("workflow")
    if key not in WORKFLOWS:
        return jsonify({"error": "Unknown workflow"}), 400
    if key in {"train", "backtest"}:
        missing_data = [name for name in ("train_data.csv", "trade_data.csv") if not (FINRL / name).exists()]
        if missing_data:
            return jsonify({"error": "Run ‘Download & prepare data’ first. Missing: " + ", ".join(missing_data)}), 409
    if key == "backtest":
        missing_models = [name for name in ("agent_a2c.zip", "agent_ddpg.zip", "agent_ppo.zip", "agent_td3.zip", "agent_sac.zip") if not (FINRL / "trained_models" / name).exists()]
        if missing_models:
            return jsonify({"error": "Run ‘Train DRL agents’ first. Missing checkpoints: " + ", ".join(missing_models)}), 409
    spec = WORKFLOWS[key]
    job_id = f"{key}-{len(jobs)+1}"
    with lock:
        jobs[job_id] = {"status": "running", "output": f"$ {PYTHON} {spec['script']}\n"}
    def worker():
        try:
            process = subprocess.Popen([str(PYTHON), spec["script"]], cwd=FINRL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            output = []
            for line in process.stdout or []:
                output.append(line)
                with lock: jobs[job_id]["output"] = "".join(output)[-12000:]
            code = process.wait()
            with lock:
                jobs[job_id]["status"] = "completed" if code == 0 else "failed"
        except Exception as error:
            with lock: jobs[job_id].update(status="failed", output=str(error))
    threading.Thread(target=worker, daemon=True).start()
    return jsonify({"id": job_id})

@app.get("/api/jobs/<job_id>")
def job(job_id):
    with lock: result = jobs.get(job_id)
    if not result: return jsonify({"error": "Job not found"}), 404
    return jsonify(result)

if __name__ == "__main__":
    print(f"FinRL local workbench running at http://127.0.0.1:{PORT}")
    app.run(host="127.0.0.1", port=PORT, debug=False)
