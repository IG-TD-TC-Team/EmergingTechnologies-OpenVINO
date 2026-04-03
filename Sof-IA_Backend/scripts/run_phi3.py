import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# from src.slm.phi3_pytorch import Phi3PyTorch
from src.slm.phi3_openvino import Phi3OpenVINO
import time

patient = "65-year-old male with hypertension, chest pain on exertion for 3 weeks."

# ── PyTorch (commented out — too slow on CPU) ─────────────────────────────────
# print("=" * 60)
# print("Backend: PyTorch CPU")
# print("=" * 60)
# pt = Phi3PyTorch()
# pt.load()
# start = time.time()
# note = pt.generate_clinical_note(patient, max_tokens=50)
# elapsed = time.time() - start
# print(note)
# print(f"\nLatency : {elapsed:.1f}s")

# ── OpenVINO ──────────────────────────────────────────────────────────────────
print("=" * 60)
print("Backend: OpenVINO INT8")
print("=" * 60)

ov = Phi3OpenVINO()
ov.load()

start = time.time()
note = ov.generate_clinical_note(patient, max_tokens=512)
elapsed = time.time() - start

print(note)
print(f"\nLatency : {elapsed:.1f}s")