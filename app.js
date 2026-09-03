      // ==========================================
      // 1. 外部依賴與系統設定 (Configuration)
      // ==========================================

      /* Tailwind 設定 (保留在 head 內) */

      /* GIST API 設定 */
      // ─── 部署切換 ───────────────────────────────────────────
      // USE_WORKER=true (預設)：所有 Gist API 走 Cloudflare Worker，Token 藏在 Worker 環境變數
      //                        HTML 本身完全不需要 Token
      // USE_WORKER=false：緊急備援，直連 GitHub API，需要在下方 GITHUB_TOKEN 填 token
      // ───────────────────────────────────────────────────────
      const USE_WORKER = true;
      const WORKER_URL = "https://oring-ec.oring-ec.workers.dev";
      // fallback 用（USE_WORKER=false 時才需要值；平常留空即可）
      const GITHUB_TOKEN = "";
      // 統一的 API base（下方所有 fetch 都用這個）
      const GITHUB_API_BASE = USE_WORKER ? WORKER_URL : "https://api.github.com";
      const GIST_CONFIG = {
        ECN: {
          ID: "7190f36d8807a66606f4e0b5e88b431b",
          PREFIX: { ECN: "ecn_" },
          FILES: { SETTINGS: "settings.json", HOLIDAYS: "holidays.json" },
        },
        BOARD: {
          ID: "cbc516cd89b725bdbc68cdc9c5d38eda",
          PREFIX: { NEW: "board_new_", MAINTAIN: "board_maint_" },
        },
        PCB: {
          ID: "04c5e8e07c08bcb4517bf0b58b314e39",
          PREFIX: {
            LIST: "pcb_list_",
            GPMS: "pcb_gpms_",
            MAINTAIN: "pcb_maint_",
          },
        },
        OTHER: {
          ID: "dff71a370039d5f77bbc08fced2590bf",
          PREFIX: {
            PLM: "plm_",
            ASSIST: "assist_",
            DISABLE: "disable_",
            BOM: "bom_",
            DCC: "dcc_",
          },
        },
        ECRECN: {
          ID: "689c65d601ec897b65c65bfb0158a856",
          PREFIX: { ECR_ECN: "ecrecn_" },
        },
      };
      const FILE_NAME_MAP = {
        ecn: "ECN 清單",
        transfer: "新人類轉單",
        board_new: "新建板階",
        board_maint: "板階維護",
        pcb_list: "PCB 清單",
        pcb_gpms: "GPMS 啟動",
        pcb_maint: "PCB 維護",
        plm: "資料匯出",
        assist: "協助項目",
        disable: "停用取替代",
        bom: "BOM 建立",
        dcc: "管制文件申請",
        ecrecn: "ECR/ECN 追蹤",
      };

      /* BPM API 模組（ECRlist / ECRstep / ECNstep / PCBstep） */
      const ApiModule = (() => {
        const BASE = "http://192.168.2.26:81/BPMPro/";
        const ENDPOINTS = {
          ECRlist: "ORing_GetECRlist.aspx",
          ECRstep: "ORing_GetECRstep.aspx",
          ECNstep: "ORing_GetECNstep.aspx",
          PCBstep: "ORing_GetPCBstep.aspx",
        };
        const cache = new Map();      // name -> { data, time }
        const inflight = new Map();   // name -> Promise（避免並發重複呼叫）

        async function fetchOne(name) {
          if (!ENDPOINTS[name]) throw new Error("未知 API: " + name);
          if (inflight.has(name)) return inflight.get(name);
          const promise = (async () => {
            try {
              const r = await fetch(BASE + ENDPOINTS[name]);
              if (!r.ok) throw new Error("HTTP " + r.status);
              const data = await r.json();
              cache.set(name, { data, time: new Date() });
              return data;
            } catch (e) {
              console.error("[ApiModule] " + name + " 撈取失敗:", e.message);
              throw e;
            } finally {
              inflight.delete(name);
            }
          })();
          inflight.set(name, promise);
          return promise;
        }

        /* 對外 API：fetch (快取) / refresh (強制重抓) */
        return {
          async fetch(name) {
            if (cache.has(name)) return cache.get(name).data;
            return fetchOne(name);
          },
          async fetchMany(names) {
            return Promise.all(names.map((n) => this.fetch(n)));
          },
          async refresh(name) {
            cache.delete(name);
            return fetchOne(name);
          },
          async refreshMany(names) {
            names.forEach((n) => cache.delete(n));
            return Promise.all(names.map((n) => fetchOne(n)));
          },
          clearCache() { cache.clear(); },
          getCacheTime(name) { return cache.get(name)?.time || null; },
          isCached(name) { return cache.has(name); },
        };
      })();

      /* 表單狀態正規化與表單撤回判斷 */
      const StatusModule = (() => {
        const ALIAS = { "起單人撤回": "表單撤回" };
        const VOID_LIKE = ["駁回結束", "表單撤回"];
        return {
          normalize: (s) => {
            const v = (s || "").trim();
            return ALIAS[v] || v;
          },
          /* 判斷是否屬於撤回類(KPI/天數計算需略過) */
          isVoid: (s) => VOID_LIKE.includes(s),
        };
      })();

      /* ECR/ECN 關卡名稱表 */
      const StepNameModule = (() => {
        const ECR_FULL = {
          AplSlf01: "【一】申請人",
          SpcMem01: "【二.1】採購單位(原物料數量盤查)",
          SpcMem02: "【二.2】物管單位(原物料數量盤查)",
          SpcMem03: "【二.3】生管單位(成/半品數量盤查)",
          SpcMem04: "【二.4】生產工程單位(可行性評估)",
          SpcMem05: "【▲三】CE單位(可行性評估)",
          SpcMem06: "【▲三】PCM單位(可行性評估)",
          SpcMem07: "【▲三】RD單位ISW_HW(可行性評估)",
          SpcMem08: "【▲三】RD單位AIOT_HW(可行性評估)",
          SpcMem09: "【▲三】RD單位ISW_SW(可行性評估)",
          SpcMem10: "【▲三】RD單位AIOT_SW(可行性評估)",
          SpcMem11: "【▲三】RD單位ME(可行性評估)",
          SpcMem12: "【▲三】SE單位ISW_SE(可行性評估)",
          SpcMem13: "【▲三】SE單位AIOT_SE(可行性評估)",
          SpcMem14: "【四】PM_ISW(確認與通知)",
          SpcMem15: "【四】PM_AIOT(確認與通知)",
          SpcMem16: "【六】PD主管(確認簽核)",
          SpcMem17: "【七】協辦單位(結案資訊)",
          SpcMem18: "【四】PM_ISW SW(確認與通知)",
          SpcMem19: "【四】PM_AIOT SW(確認與通知)",
          SpcMem20: "【六】QA主管(確認簽核)",
          SpcMem21: "【五】PM主管_ISW(確認簽核)",
          SpcMem22: "【五】PM主管_AIOT(確認簽核)",
          "#QUERYOPINION!": "徵詢意見",
          "#WAIT4ADVICE!": "等待指示",
        };
        const ECN_FULL = {
          AplSlf01: "【一】申請人",
          SpcMem01: "【二】協辦單位(變更完成資訊)",
          SpcMem02: "【四.1】採購單位(回報資訊)",
          SpcMem03: "【三.1】物管單位(回報資訊)",
          SpcMem04: "【三.2】生管單位(回報資訊)",
          SpcMem05: "【四.2】工程單位(回報資訊)",
          SpcMem06: "【四.3】品管單位(回報資訊)",
          "#QUERYOPINION!": "徵詢意見",
          "#WAIT4ADVICE!": "等待指示",
        };
        const SHORT = {
          "【一】申請人": "【一】申請人",
          "【二.1】採購單位": "【二.1】採購", "【二.2】物管單位": "【二.2】物管",
          "【二.3】生管單位": "【二.3】生管", "【二.4】生產工程單位": "【二.4】工程",
          "【▲三】CE單位": "【▲三】CE", "【▲三】PCM單位": "【▲三】PCM",
          "【▲三】RD單位ISW_HW": "【▲三】ISW_HW", "【▲三】RD單位AIOT_HW": "【▲三】AIOT_HW",
          "【▲三】RD單位ISW_SW": "【▲三】ISW_SW", "【▲三】RD單位AIOT_SW": "【▲三】AIOT_SW",
          "【▲三】SE單位ISW_SE": "【▲三】ISW_SE", "【▲三】SE單位AIOT_SE": "【▲三】AIOT_SE",
          "【▲三】RD單位ME": "【▲三】ME",
          "【四】PM_ISW": "【四】PM_ISW", "【四】PM_AIOT": "【四】PM_AIOT",
          "【五】PM主管_ISW": "【五】PM主管_ISW", "【五】PM主管_AIOT": "【五】PM主管_AIOT",
          "【六】QA主管": "【六】QA主管", "【六】PD主管": "【六】PD主管",
          "【七】協辦單位": "【七】協辦",
          "【二】協辦單位": "【二】協辦",
          "【三.1】物管單位": "【三.1】物管", "【三.2】生管單位": "【三.2】生管",
          "【四.1】採購單位": "【四.1】採購", "【四.2】工程單位": "【四.2】工程",
          "【四.3】品管單位": "【四.3】品管",
        };
        const ECR_ORDER = ["【一】申請人","【二.1】採購","【二.2】物管","【二.3】生管","【二.4】工程",
          "【▲三】CE","【▲三】PCM","【▲三】ISW_HW","【▲三】AIOT_HW","【▲三】ISW_SW","【▲三】AIOT_SW",
          "【▲三】ISW_SE","【▲三】AIOT_SE","【▲三】ME",
          "【四】PM_ISW","【四】PM_AIOT","【四】PM_ISW SW","【四】PM_AIOT SW",
          "【五】PM主管_ISW","【五】PM主管_AIOT",
          "【六】QA主管","【六】PD主管","【七】協辦"];
        const ECN_ORDER = ["【一】申請人","【二】協辦","【三.1】物管","【三.2】生管",
          "【四.1】採購","【四.2】工程","【四.3】品管"];

        return {
          fullEcr: (pid) => ECR_FULL[pid] || pid,
          fullEcn: (pid) => ECN_FULL[pid] || pid,
          short: (raw) => SHORT[raw] || raw,
          ECR_ORDER,
          ECN_ORDER,
        };
      })();

      /* BPM API 資料轉換小幫手格式 */
      const ApiAdapter = (() => {
        const normalizeStatus = StatusModule.normalize;

        /* 取某關卡最新一筆 (requireApproved=true只取同意) */
        function findLatestApproval(approvalData, processID, requireApproved = false) {
          let list = (approvalData || []).filter((a) => a.ProcessID === processID);
          if (requireApproved) list = list.filter((a) => a.ResultPrompt === "同意");
          if (!list.length) return null;
          return list.sort((a, b) => (b.ApproveTime || "").localeCompare(a.ApproveTime || ""))[0];
        }

        /* 特殊 ProcessID：等待指示 / 徵詢意見 */
        const SPECIAL_PROCESS_IDS = ["#WAIT4ADVICE!", "#QUERYOPINION!"];

        /* 組簽核字串 */
        function formatNextApprovers(arr) {
          if (!arr || !arr.length) return "";

          const normal = [];
          const specials = [];
          for (const a of arr) {
            (SPECIAL_PROCESS_IDS.includes(a.ProcessID) ? specials : normal).push(a);
          }
          const principals = normal.filter((a) => a.IsAgent !== 2);
          const agents = normal.filter((a) => a.IsAgent === 2);

          const lines = [];
          const matchedSpecials = new Set();
          const matchedAgents = new Set();

          for (const a of principals) {
            const myAgents = agents.filter((g) => g.OriginalApprover === a.ApproverID);
            myAgents.forEach((g) => matchedAgents.add(g));
            const agentsStr = myAgents.map((g) => `,(代理)${g.ApproverID || ""}`).join("");
            lines.push(`${a.DisplayName || ""} - ${a.ApproverID || ""}${agentsStr}`);
            for (const s of specials) {
              if (s.DynaAddByWhom && s.DynaAddByWhom === a.ApproverID) {
                lines.push(`　↳ ${s.DisplayName || ""} - ${s.ApproverID || ""}`);
                matchedSpecials.add(s);
              }
            }
          }

          for (const g of agents) {
            if (!matchedAgents.has(g)) {
              lines.push(`${g.DisplayName || ""} - (代理)${g.ApproverID || ""}`);
            }
          }

          for (const s of specials) {
            if (!matchedSpecials.has(s)) {
              lines.unshift(`${s.DisplayName || ""} - ${s.ApproverID || ""}`);
            }
          }

          return lines.join("\n");
        }

        /* P20 ECR 結案簽核資訊 */
        function buildClosedSignInfo(stepData, processID) {
          const last = findLatestApproval(stepData, processID, true);
          if (!last) return "";
          const display = StepNameModule.fullEcr(processID);
          return `${display} - ${last.ApproverName || ""}`;
        }

        /* P20 ECN 結案簽核資訊 */
        function buildEcnClosedSign(stepData) {
          if (!stepData || !stepData.length) return "";
          let last = null;
          for (const a of stepData) {
            if ((a.ResultPrompt || "") !== "同意") continue;
            if (SPECIAL_PROCESS_IDS.includes(a.ProcessID)) continue;
            if (!last || (a.ApproveTime || "") > (last.ApproveTime || "")) last = a;
          }
          if (!last) return "";
          const display = StepNameModule.fullEcn(last.ProcessID);
          return `${display} - ${last.ApproverName || last.ApproverID || ""}`;
        }

        /* 同單號去重，取最新申請時間 */
        function dedupeBySerialLatest(arr, serialKey, timeKey) {
          const map = new Map();
          for (const r of arr) {
            const id = r[serialKey];
            if (!id) continue;
            const ex = map.get(id);
            if (!ex || (r[timeKey] || "") > (ex[timeKey] || "")) {
              map.set(id, r);
            }
          }
          return Array.from(map.values());
        }

        /* SerialID → ApprovalData 查表 */
        function buildStepMap(steps) {
          const m = {};
          for (const s of steps || []) {
            if (!s || !s.SerialID) continue;
            if (!m[s.SerialID]) m[s.SerialID] = [];
            if (s.ApprovalData && s.ApprovalData.length) m[s.SerialID].push(...s.ApprovalData);
          }
          return m;
        }

        /* P20 無 ECN 佔位字串集合 */
        const ECN_PLACEHOLDERS = new Set(["(無ECN)", "(ECR尚未結案)", "不執行ECN"]);
        /* 判斷 ecnSerial 是否為佔位（空字串或任一佔位字串） */
        function isEcnPlaceholder(s) {
          return !s || ECN_PLACEHOLDERS.has(s);
        }

        /* P20 API → ECR/ECN 追蹤報告陣列 */
        function toEcrEcnRows(ecrList, ecrSteps, ecnSteps) {
          const dedupedEcrList = dedupeBySerialLatest(ecrList, "SerialID", "ApplicantDateTime");

          const ecrStepMap = buildStepMap(ecrSteps);
          const ecnStepMap = buildStepMap(ecnSteps);

          const rows = [];
          for (const ecr of dedupedEcrList) {
            const ecrSerial = ecr.SerialID;
            const ecrStepData = ecrStepMap[ecrSerial] || [];

            // ECR 結案日（最新一筆 SpcMem17 同意）
            const closeRow = findLatestApproval(ecrStepData, "SpcMem17", true);
            const ecrStep7Time = closeRow ? closeRow.ApproveTime : "";

            // ECR 簽核資訊：優先用 NextApproverData（進行中），結案則找 SpcMem17 最後簽核人
            let ecrSignInfo = formatNextApprovers(ecr.NextApproverData);
            if (!ecrSignInfo) ecrSignInfo = buildClosedSignInfo(ecrStepData, "SpcMem17");

            const ecrBase = {
              ecrSerial,
              ecrStatusText: normalizeStatus(ecr.Status),
              ecrApplyTime: ecr.ApplicantDateTime || "",
              ecrApplicantDept: ecr.ApplicantDeptName || "",
              ecrApplicant: ecr.ApplicantName || "",
              ecrSignInfo,
              ecrStep7Time,
            };

            if (!ecr.ECN || ecr.ECN.length === 0) {
              const status = ecrBase.ecrStatusText;
              let ecnSerialDisplay = "";
              if (status === "表單撤回" || status === "駁回結束") {
                ecnSerialDisplay = "";
              } else if (ecr.ECRToECNChangeProceed === "否") {
                ecnSerialDisplay = "不執行ECN";
              } else if (status === "進行中") {
                ecnSerialDisplay = "(ECR尚未結案)";
              } else if (status === "同意結束") {
                ecnSerialDisplay = "(無ECN)";
              }
              rows.push({
                ...ecrBase,
                ecnSerial: ecnSerialDisplay,
                ecnStatusText: "",
                ecnApplyTime: "",
                ecnApplicantDept: "",
                ecnApplicant: "",
                ecnSignInfo: "",
                ecnStep2Time: "",
              });
            } else {
              for (const ecn of ecr.ECN) {
                const ecnStepData = ecnStepMap[ecn.SerialID] || [];
                const ecn2 = findLatestApproval(ecnStepData, "SpcMem01", true);

                let ecnSignInfo = formatNextApprovers(ecn.NextApproverData);
                if (!ecnSignInfo) ecnSignInfo = buildEcnClosedSign(ecnStepData);

                rows.push({
                  ...ecrBase,
                  ecnSerial: ecn.SerialID,
                  ecnStatusText: normalizeStatus(ecn.Status),
                  ecnApplyTime: ecn.ApplicantDateTime || "",
                  ecnApplicantDept: ecn.ApplicantDeptName || "",
                  ecnApplicant: ecn.ApplicantName || "",
                  ecnSignInfo,
                  ecnStep2Time: ecn2 ? ecn2.ApproveTime : "",
                });
              }
            }
          }

          rows.sort((a, b) => (b.ecrSerial || "").localeCompare(a.ecrSerial || ""));
          return rows;
        }

        /* P1/P3 取關卡最新簽核 */
        function findLatestRealSign(stepData, processIDs) {
          const ids = Array.isArray(processIDs) ? processIDs : [processIDs];
          const isApplyQuery = ids.includes("AplSlf01");
          const list = (stepData || []).filter((a) => {
            const r = a.ResultPrompt || "";
            if (!r) return false;
            if (r.includes("變更簽核")) return false;
            if (r.includes("等待指示")) return false;
            if (r === "表單撤回") return isApplyQuery;
            return ids.includes(a.ProcessID);
          });
          if (!list.length) return null;
          return list.sort((a, b) => (b.ApproveTime || "").localeCompare(a.ApproveTime || ""))[0];
        }

        /* P1 變更原因 */
        function formatChangeReason(obj) {
          if (!obj || typeof obj !== "object") return "";
          const stripNumPrefix = (s) => (s || "").replace(/^\d+(?:\.\d+)*\.?\s*/, "").trim();
          const parts = [];
          for (const [k, v] of Object.entries(obj)) {
            const keyDisplay = Utils.stripParens(k);
            const isOther = stripNumPrefix(keyDisplay) === "其他";
            if (isOther) parts.push(`${keyDisplay}:${v || ""}`);
            else parts.push(`${keyDisplay}-${stripNumPrefix(Utils.stripParens(v))}`);
          }
          return parts.join(";");
        }

        /* P1 API → ECN 詳細清單陣列 */
        function toEcnListRows(ecrList, ecnSteps) {
          const ecnStepMap = buildStepMap(ecnSteps);

          const allEcns = [];
          for (const ecr of ecrList) {
            if (!ecr.ECN || !ecr.ECN.length) continue;
            const changeReason = formatChangeReason(ecr.ECRChangeClassification);
            for (const ecn of ecr.ECN) {
              allEcns.push({ ...ecn, _parentEcr: ecr.SerialID, _changeReason: changeReason });
            }
          }

          const deduped = dedupeBySerialLatest(allEcns, "SerialID", "ApplicantDateTime");

          return deduped.map((ecn) => {
            const stepData = ecnStepMap[ecn.SerialID] || [];
            const apply = findLatestRealSign(stepData, "AplSlf01");
            const approveTime1 = apply ? apply.ApproveTime : "";
            const collab = findLatestRealSign(stepData, "SpcMem01");
            const approveTime = collab ? collab.ApproveTime : "";
            const approver = collab ? collab.ApproverName : "";
            const arriveDate = collab ? collab.ArrivalTime : "";
            const status = normalizeStatus(ecn.Status);
            const isRejected1 = !!(apply && (apply.ResultPrompt || "").includes("駁回"));
            const isRejected = !!(collab && (collab.ResultPrompt || "").includes("駁回"));
            const applyTime = ecn.ApplicantDateTime || "";
            const month = applyTime ? applyTime.substring(0, 7).replace("-", "/") : "";
            const row = {
              id: ecn.SerialID,
              ecrId: ecn._parentEcr || ecn.ECNECRNo || "",
              status,
              applicant: ecn.ApplicantName || "",
              applyTime,
              approveTime,
              approveTime1,
              arriveDate,
              approver,
              priority: ecn.ECNDemandLevel || "",
              partNo: ecn.ECNPrepareToChangeProductNumber || "",
              changeReason: ecn._changeReason || "",
              scope: (ecn.ECNCoorganizerChangeScope || "").replace(/[,，]/g, ";"),
              isRejected,
              isRejected1,
              month,
              /* 以下由 overlay 填 */
              plmStart: "",
              plmRelease: "",
              complexity: "",
              overdueNote: "",
            };
            return row;
          });
        }

        /* P10 API → 新人類轉單統計陣列 */
        function toTransferRows(ecrList, ecrSteps, ecnSteps) {
          const ecrInfoMap = new Map();
          const ecnInfoMap = new Map();
          for (const ecr of ecrList) {
            ecrInfoMap.set(ecr.SerialID, {
              dept: ecr.ApplicantDeptName || "",
              applicant: ecr.ApplicantName || "",
            });
            if (!ecr.ECN) continue;
            for (const ecn of ecr.ECN) {
              ecnInfoMap.set(ecn.SerialID, {
                dept: ecn.ApplicantDeptName || "",
                applicant: ecn.ApplicantName || "",
              });
            }
          }

          const rows = [];
          const eng = (n) => extractEngName(n) || n || "";

          // ECR：SpcMem17全紀錄（只保留isKPITarget人員）
          for (const ecr of ecrSteps) {
            const info = ecrInfoMap.get(ecr.SerialID);
            if (!info) continue;
            for (const a of ecr.ApprovalData || []) {
              if (a.ProcessID !== "SpcMem17") continue;
              if (!a.ResultPrompt) continue;   // 沒實際送簽 (BPM 存檔但未簽核) 不算
              if (!isKPITarget(a.ApproverName)) continue;
              rows.push({
                type: "ECR",
                formId: ecr.SerialID,
                dept: info.dept,
                applicant: info.applicant,
                step: "【七】協辦單位(結案資訊)",
                arriveDate: a.ArrivalTime || "",
                approveDate: a.ApproveTime || "",
                result: a.ResultPrompt || "",
                executor: eng(a.ApproverName),
                comment: (a.Comment || "").trim(),
              });
            }
          }

          // ECN：SpcMem01全紀錄（只保留isKPITarget人員）
          for (const ecn of ecnSteps) {
            const info = ecnInfoMap.get(ecn.SerialID);
            if (!info) continue;
            for (const a of ecn.ApprovalData || []) {
              if (a.ProcessID !== "SpcMem01") continue;
              if (!a.ResultPrompt) continue;   // 沒實際送簽 (BPM 存檔但未簽核) 不算
              if (!isKPITarget(a.ApproverName)) continue;
              rows.push({
                type: "ECN",
                formId: ecn.SerialID,
                dept: info.dept,
                applicant: info.applicant,
                step: "【二】協辦單位(變更完成資訊)",
                arriveDate: a.ArrivalTime || "",
                approveDate: a.ApproveTime || "",
                result: a.ResultPrompt || "",
                executor: eng(a.ApproverName),
                comment: (a.Comment || "").trim(),
              });
            }
          }
          rows.sort((a, b) => (b.approveDate || "").localeCompare(a.approveDate || ""));
          return rows;
        }

        /* P3 承認 PCB 顯示對應 */
        function normalizeApproveValue(s) {
          if (!s) return "";
          if (s.includes("不承認") || s.includes("不需承認")) return "不承認";
          if (s.includes("承認")) return "承認";
          return s;
        }

        /* P3 簽核人、簽核時間、是否駁回 */
        function buildStepCell(stepData, processIDs) {
          const entry = findLatestRealSign(stepData, processIDs);
          if (!entry) return { name: "", time: "", isRejected: false };
          const name = extractEngName(entry.ApproverName) || entry.ApproverName || "";
          const time = entry.ApproveTime || "";
          const isRejected = (entry.ResultPrompt || "").includes("駁回");
          return { name, time, isRejected };
        }

        /* P3 API → PCB 詳細清單陣列 */
        function toPcbListRows(pcbSteps) {
          const dedupedList = dedupeBySerialLatest(pcbSteps, "SerialID", "ApplicantDateTime");
          return dedupedList.map((p) => {
            const stepData = p.ApprovalData || [];

            // 各關卡
            const s2 = buildStepCell(stepData, ["AplDpt01", "Instctr01"]);
            const s3 = buildStepCell(stepData, "SpcMem01");
            const s7 = buildStepCell(stepData, "SpcMem04");
            const s8 = buildStepCell(stepData, "SpcMem05");
            const s15 = buildStepCell(stepData, "SpcMem10");
            const s18 = buildStepCell(stepData, "SpcMem11");

            // 承認 PCB：優先 PcbApplicantApprovalPcb，其次 PcbApplicantAcknowledgePCB
            const needApprove = normalizeApproveValue(p.PcbApplicantApprovalPcb || p.PcbApplicantAcknowledgePCB || "");

            const row = {
              id: p.SerialID,
              partNo: (p.PcbMaterialNumber || "").replace(/\s+/g, ""),
              status: normalizeStatus(p.Status),
              applicant: extractEngName(p.ApplicantName) || p.ApplicantName || "",
              priority: p.PcbLevel || "",
              name2: s2.name, time2: s2.time, isRejected2: s2.isRejected,
              name3: s3.name, time3: s3.time, isRejected3: s3.isRejected,
              name7: s7.name, time7: s7.time, isRejected7: s7.isRejected,
              name8: s8.name, time8: s8.time, isRejected8: s8.isRejected,
              needApprove,
              name13: s15.name, time13: s15.time, isRejected13: s15.isRejected,
              name15: s18.name, time15: s18.time, isRejected15: s18.isRejected,
              // 可編輯欄位 (更新日期）
              updateDate1: "", note1: "", updateDate2: "", note2: "",

              kpi1: "-", kpi2: "-",
            };
            return row;
          });
        }

        /* P8 GPMS 啟動清單：抓有走到 SpcMem12 那關的 PCB 表單 */
        function toGpmsRows(pcbSteps) {
          const rows = [];
          for (const p of pcbSteps || []) {
            const latest = findLatestRealSign(p.ApprovalData, "SpcMem12");
            if (!latest) continue;
            const dateOnly = (latest.ApproveTime || "").substring(0, 10).replace(/-/g, "/");
            rows.push({
              id: p.SerialID,
              date: dateOnly,
              pcbNo: p.SerialID,
              partNo: (p.PcbMaterialNumber || "").replace(/\s+/g, ""),
              maintainer: extractEngName(latest.ApproverName) || latest.ApproverName || "",
              note: "",
            });
          }
          return rows;
        }

        /* P3 KPI 計算 */
        function preprocessPcbListRows(rows) {
          for (const r of rows || []) {
            const k1 = r.isRejected3 ? "-" : DateUtils.calcWorkDays(r.time2, r.updateDate1 || r.time3);
            const k2 = r.isRejected8 ? "-" : DateUtils.calcWorkDays(r.time7, r.updateDate2 || r.time8);
            const k3 = r.isRejected15 ? "-" : DateUtils.calcWorkDays(r.time13, r.time15);
            r.kpi1 = typeof k1 === "number" ? k1 : "-";
            r.kpi2 = typeof k2 === "number" ? k2 : "-";
            r.kpi3 = typeof k3 === "number" ? k3 : "-";
          }
        }

        return {
          toEcrEcnRows,
          toEcnListRows,
          toTransferRows,
          toPcbListRows,
          toGpmsRows,
          preprocessPcbListRows,
          normalizeStatus,
          findLatestApproval,
          dedupeBySerialLatest,
          isEcnPlaceholder,
          ECN_PLACEHOLDERS,
        };
      })();

      /* API + GIST overlay 合併 */
      const OverlayModule = {
        ECN_FIELDS: ["plmStart", "plmRelease", "complexity", "overdueNote"],
        ecn: new Map(), // id → { plmStart, plmRelease, complexity, overdueNote }

        PCB_FIELDS: ["updateDate1", "note1", "updateDate2", "note2"],
        pcb: new Map(), // id → { updateDate1, note1, updateDate2, note2 }

        /* _override(ECN/PCB 通用)：手填欄位強制覆蓋 */
        _extractOverride(r) {
          return (r._override && typeof r._override === "object") ? r._override : null;
        },
        _hasOverride(o) {
          return !!o._override;
        },
        _applyOverride(row, o) {
          if (o._override) {
            Object.assign(row, o._override);
            row._override = o._override;
          }
        },

        /* === ECN overlay === */
        loadEcnFromArray(records) {
          this.ecn.clear();
          for (const r of records || []) {
            if (!r || !r.id) continue;
            const o = this.extractEcnFields(r);
            if (this.hasEcnContent(o)) this.ecn.set(r.id, o);
          }
        },
        extractEcnFields(r) {
          const o = {};
          for (const f of this.ECN_FIELDS) if (r[f]) o[f] = r[f];
          const ov = this._extractOverride(r);
          if (ov) o._override = ov;
          return o;
        },
        hasEcnContent(o) {
          return this.ECN_FIELDS.some((f) => o[f]) || this._hasOverride(o);
        },
        applyEcn(row) {
          const o = this.ecn.get(row.id);
          if (!o) return row;
          for (const f of this.ECN_FIELDS) if (o[f]) row[f] = o[f];
          this._applyOverride(row, o);
          return row;
        },
        // ECN id 格式 ECN-YYYYMM-NNN，從中抽年份
        buildEcnByYear(ecnDataArr) {
          const byYear = {};
          for (const r of ecnDataArr || []) {
            if (!r || !r.id) continue;
            const o = this.extractEcnFields(r);
            if (!this.hasEcnContent(o)) continue;
            const m = r.id.match(/-(\d{4})\d{2}-/);
            const year = m ? m[1] : (r.month || "").substring(0, 4);
            if (!year) continue;
            if (!byYear[year]) byYear[year] = [];
            byYear[year].push({ id: r.id, ...o });
          }
          return byYear;
        },

        /* === PCB overlay === */
        loadPcbFromArray(records) {
          this.pcb.clear();
          for (const r of records || []) {
            if (!r || !r.id) continue;
            const o = this.extractPcbFields(r);
            if (this.hasPcbContent(o)) this.pcb.set(r.id, o);
          }
        },
        extractPcbFields(r) {
          const o = {};
          for (const f of this.PCB_FIELDS) if (r[f]) o[f] = r[f];
          const ov = this._extractOverride(r);
          if (ov) o._override = ov;
          return o;
        },
        hasPcbContent(o) {
          return this.PCB_FIELDS.some((f) => o[f]) || this._hasOverride(o);
        },
        applyPcb(row) {
          const o = this.pcb.get(row.id);
          if (!o) return row;
          for (const f of this.PCB_FIELDS) if (o[f]) row[f] = o[f];
          this._applyOverride(row, o);
          return row;
        },
        // PCB id 格式 PNAx-YYYY-MM-NNNN，從中抽年份
        buildPcbByYear(pcbDataArr) {
          const byYear = {};
          for (const r of pcbDataArr || []) {
            if (!r || !r.id) continue;
            const o = this.extractPcbFields(r);
            if (!this.hasPcbContent(o)) continue;
            const m = r.id.match(/-(\d{4})-/);
            const year = m ? m[1] : (r.time3 || "").substring(0, 4);
            if (!year) continue;
            if (!byYear[year]) byYear[year] = [];
            byYear[year].push({ id: r.id, ...o });
          }
          return byYear;
        },
      };

      /* 分年份儲存模組 */
      const YearlyModule = {
        dateFields: {
          ecn: "month",
          transfer: "approveDate",
          board_new: "createDate",
          board_maint: "date",
          pcb_list: "time3",
          pcb_gpms: "date",
          pcb_maint: "date",
          plm: "date",
          assist: "date",
          disable: "date",
          bom: "completeDate",
          dcc: "date",
          ecrecn: "ecrApplyTime",
        },
        getDateFns: {},
        fileTimestamps: {},

        // 從記錄中取得年份
        getYear(record, dateField) {
          if (!record || !dateField) return null;
          const val = record[dateField];
          if (!val) return null;
          const match = String(val).match(/^(\d{4})/);
          return match ? match[1] : null;
        },

        // 按年份分組資料
        groupByYear(data, dateField, getDateFn = null) {
          const groups = {};
          const currentYear = String(new Date().getFullYear());
          (data || []).forEach((record) => {
              let year;
              if (getDateFn) {
                  const dateVal = getDateFn(record);
                  const match = String(dateVal || "").match(/^(\d{4})/);
                  year = match ? match[1] : null;
              } else {
                  year = this.getYear(record, dateField);
              }
              year = year || currentYear;
              if (!groups[year]) groups[year] = [];
              groups[year].push(record);
          });
          return groups;
        },

        // 從 Gist 檔案清單解析可用年份
        parseYears(files, prefix) {
          const years = new Set();
          Object.keys(files || {}).forEach((name) => {
            const match = name.match(new RegExp(`^${prefix}(\\d{4})\\.json$`));
            if (match) years.add(match[1]);
          });
          return [...years].sort().reverse();
        },

        // 從 Gist 載入分年份資料並合併
        loadAndMerge(files, prefix, dateField) {
          const years = this.parseYears(files, prefix);
          let merged = [];
          years.forEach((year) => {
            const fileName = `${prefix}${year}.json`;
            if (files[fileName]) {
              try {
                const content = JSON.parse(files[fileName].content);
                const records = content.records || (Array.isArray(content) ? content : []);
                merged = merged.concat(records);
                if (content._lastUpdated) {
                  const key = `${prefix}${year}`;
                  this.fileTimestamps[key] = new Date(content._lastUpdated);
                }
              } catch (e) {
                console.warn(`解析 ${fileName} 失敗`, e);
              }
            }
          });
          return merged;
        },

        // 取得某類型最新的更新時間
        getLatestTimestamp(prefix, years) {
          let latest = null;
          (years || []).forEach((year) => {
            const key = `${prefix}${year}`;
            const time = this.fileTimestamps[key];
            if (time && (!latest || time > latest)) latest = time;
          });
          return latest;
        },

        // 產生分年份儲存的 files 物件
        buildSaveFiles(data, prefix, dateField, getDateFn = null) {
          const byYear = this.groupByYear(data, dateField, getDateFn);
          const files = {};
          const timestamp = new Date().toISOString();
          Object.entries(byYear).forEach(([year, records]) => {
            if (year && year !== "unknown" && records.length > 0) {
              const fileName = `${prefix}${year}.json`;
              files[fileName] = {
                content: JSON.stringify({ _lastUpdated: timestamp, records }),
              };
              this.fileTimestamps[`${prefix}${year}`] = new Date(timestamp);
            }
          });
          return files;
        },

        // 追蹤哪些年份有變更
        dirtyYears: {
          ecn: new Set(),
          transfer: new Set(),
          board_new: new Set(),
          board_maint: new Set(),
          pcb_list: new Set(),
          pcb_gpms: new Set(),
          pcb_maint: new Set(),
          plm: new Set(),
          assist: new Set(),
          disable: new Set(),
          bom: new Set(),
          dcc: new Set(),
          ecrecn: new Set(),
        },

        // 標記某類型某年份為髒
        markDirty(type, year) {
          if (year && year !== "unknown" && this.dirtyYears[type]) {
            this.dirtyYears[type].add(year);
          }
        },
        // 從記錄標記髒年份
        markDirtyFromRecord(type, record) {
          const dateField = this.dateFields[type];
          const getDateFn = this.getDateFns[type];
          let year;
          if (getDateFn) {
              const dateVal = getDateFn(record);
              const match = String(dateVal || "").match(/^(\d{4})/);
              year = match ? match[1] : null;
          } else {
              year = this.getYear(record, dateField);
          }
          year = year || String(new Date().getFullYear());
          this.markDirty(type, year);
        },
        // 清除某類型的髒標記
        clearDirty(type) {
          if (this.dirtyYears[type]) {
            this.dirtyYears[type].clear();
          }
        },
        // 取得某類型的髒年份
        getDirtyYears(type) {
          return this.dirtyYears[type] ? [...this.dirtyYears[type]] : [];
        },
        // 檢查是否有髒資料
        hasDirty(type) {
          return this.dirtyYears[type] && this.dirtyYears[type].size > 0;
        },
        // 只產生髒年份的儲存檔案（不更新 timestamp，由呼叫端在 API 成功後更新）
        buildDirtySaveFiles(data, prefix, dateField, type, getDateFn = null) {
          (data || []).forEach((record) => {
            if (record && record._dirty) {
              this.markDirtyFromRecord(type, record);
            }
          });

          const dirtyYears = this.getDirtyYears(type);
          if (dirtyYears.length === 0) {
            return { files: {}, timestamp: null, affectedKeys: [] };
          }

          const byYear = this.groupByYear(data, dateField, getDateFn);
          const files = {};
          const timestamp = new Date().toISOString();
          const affectedKeys = [];

          dirtyYears.forEach((year) => {
            const records = byYear[year] || [];
            if (records.length > 0) {
              const cleanRecords = records.map(r => {
                const { _dirty, _isNew, _origIdx, _idx, _workDays, _isOverdue, _stage, ...rest } = r;
                return rest;
              });
              const fileName = `${prefix}${year}.json`;
              files[fileName] = {
                content: JSON.stringify({ _lastUpdated: timestamp, records: cleanRecords }),
              };
              affectedKeys.push(`${prefix}${year}`);
            }
          });
          return { files, timestamp, affectedKeys };
        },

        // API 成功後呼叫此方法更新 timestamp
        applyTimestamps(affectedKeys, timestamp) {
          const ts = new Date(timestamp);
          affectedKeys.forEach((key) => {
            this.fileTimestamps[key] = ts;
          });
        },
      };

      /* 表格欄位拖曳排序模組 (會話內記憶) */
      const ColumnOrderModule = {
        sessionOrder: {},
        p1Columns: [
          { id: "ecnId", label: "ECN 單號", fixed: true },
          { id: "ecrId", label: "ECR 單號" },
          { id: "status", label: "表單狀態" },
          { id: "applicant", label: "申請人" },
          { id: "partNo", label: "變更品號" },
          { id: "approver", label: "協辦人" },
          { id: "priority", label: "需求等級" },
          { id: "changeReason", label: "變更原因分類" },
          { id: "scope", label: "變更範圍" },
          { id: "applyTime", label: "申請日期" },
          { id: "approveTime1", label: "【一】申請" },
          { id: "approveTime", label: "【二】協辦" },
          { id: "closeDays", label: "全流程" },
          { id: "transferDate", label: "【二】收件日" },
          { id: "complexity", label: "複雜度" },
          { id: "plmStart", label: "PLM 發起" },
          { id: "plmRelease", label: "PLM 發佈" },
          { id: "kpi1", label: "PLM 作業" },
          { id: "kpi2", label: "PLM 簽核" },
          { id: "kpi3", label: "ERP 確認" },
          { id: "ecWorkDays", label: "EC內部天數" },
          { id: "overdue", label: "逾期" },
          { id: "overdueNote", label: "逾期說明" },
        ],
        p3Columns: [
          { id: "pcbId", label: "PCB 單號", fixed: true },
          { id: "partNo", label: "PCB 料號", fixed: true },
          { id: "status", label: "狀態" },
          { id: "applicant", label: "申請人" },
          { id: "priority", label: "需求等級" },
          { id: "name2", label: "【二】部門主管" },
          { id: "time2", label: "【二】簽核日" },
          { id: "name3", label: "【三】工程中心" },
          { id: "time3", label: "【三】簽核日" },
          { id: "updateDate1", label: "更新日期" },
          { id: "kpi1", label: "KPI1" },
          { id: "overdue1", label: "逾期" },
          { id: "note1", label: "說明" },
          { id: "name7", label: "【七】Layout" },
          { id: "time7", label: "【七】簽核日" },
          { id: "name8", label: "【八】工程中心" },
          { id: "time8", label: "【八】簽核日" },
          { id: "updateDate2", label: "更新日期" },
          { id: "kpi2", label: "KPI2" },
          { id: "overdue2", label: "逾期" },
          { id: "note2", label: "說明" },
          { id: "needApprove", label: "承認PCB" },
          { id: "name13", label: "【十五】工程中心" },
          { id: "time13", label: "【十五】簽核日" },
          { id: "name15", label: "【十八】工程中心" },
          { id: "time15", label: "【十八】簽核日" },
          { id: "kpi3", label: "KPI3" },
        ],
        getOrder(k) {
          return this.sessionOrder[k] || (k === "p1" ? this.p1Columns : this.p3Columns).map((c) => c.id);
        },
        setOrder(k, o) {
          this.sessionOrder[k] = o;
        },
        reset(k) {
          delete this.sessionOrder[k];
        },
        initDraggable(sel, k, cb) {
          const thead = document.querySelector(`${sel} thead tr`);
          if (!thead || typeof Sortable === "undefined") return;
          if (thead._sortable) thead._sortable.destroy();
          const cfg = k === "p1" ? this.p1Columns : this.p3Columns;
          const ths = Array.from(thead.children);
          ths.forEach((th, i) => {
            if (!th.dataset.columnId && cfg[i]) {
              th.dataset.columnId = cfg[i].id;
              if (cfg[i].fixed) {
                th.classList.add("no-drag");
              }
            }
            if (!th.classList.contains("no-drag") && !th.querySelector(".th-text")) {
              const nodes = Array.from(th.childNodes);
              nodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                  const span = document.createElement("span");
                  span.className = "th-text";
                  span.textContent = node.textContent;
                  th.replaceChild(span, node);
                }
              });
            }
          });
          const cg = document.querySelector(`${sel} colgroup`);
          if (cg) {
            const cols = Array.from(cg.children);
            cols.forEach((col, i) => {
              if (!col.dataset.columnId && cfg[i]) col.dataset.columnId = cfg[i].id;
            });
          }
          const fixed = cfg.filter((c) => c.fixed).map((c) => c.id);
          thead._sortable = new Sortable(thead, {
            animation: 150,
            ghostClass: "sortable-ghost",
            chosenClass: "sortable-chosen",
            filter: ".no-drag, .th-text",
            preventOnFilter: false,
            onMove: (e) => !e.related.classList.contains("no-drag"),
            onStart: (e) => {
              if (fixed.includes(e.item.dataset.columnId)) {
                e.preventDefault();
                return false;
              }
            },
            onEnd: (e) => {
              const o = Array.from(thead.children)
                .map((th) => th.dataset.columnId)
                .filter((id) => id);
              this.setOrder(k, o);
              if (cb) cb(o);
            },
          });
        },
        applyColgroupOrder(sel, k) {
          const cg = document.querySelector(`${sel} colgroup`);
          if (!cg) return;
          const o = this.getOrder(k),
            m = {};
          Array.from(cg.children).forEach((c) => {
            if (c.dataset.columnId) m[c.dataset.columnId] = c;
          });
          o.forEach((id) => {
            if (m[id]) cg.appendChild(m[id]);
          });
        },
      };

      /* 儲存前衝突檢查 */
      async function quickConflictCheck(gistName, prefix, type) {
        try {
          const dirtyYears = YearlyModule.getDirtyYears(type);
          if (dirtyYears.length === 0) return { hasConflict: false };

          const res = await fetch(`${GITHUB_API_BASE}/gists/${GIST_CONFIG[gistName].ID}?t=${new Date().getTime()}`, {
            headers: { Authorization: `token ${GITHUB_TOKEN}` },
          });
          if (!res.ok) return { hasConflict: false };

          const gist = await res.json();
          const conflicts = [];

          for (const year of dirtyYears) {
            const fileName = `${prefix}${year}.json`;
            const file = gist.files?.[fileName];
            if (!file || file.truncated) continue;

            try {
              const content = JSON.parse(file.content);
              const serverTime = content._lastUpdated ? new Date(content._lastUpdated) : null;
              const localKey = `${prefix}${year}`;
              const localTime = YearlyModule.fileTimestamps[localKey];

              if (serverTime && localTime) {
                const serverMs = serverTime.getTime();
                const localMs = new Date(localTime).getTime();

                if (serverMs > localMs + 1000) {
                  conflicts.push({
                    year,
                    fileName,
                    serverTime: serverTime.toLocaleString("zh-TW"),
                    localTime: new Date(localTime).toLocaleString("zh-TW"),
                  });
                }
              }
            } catch (e) {
              console.warn(`解析 ${fileName} 失敗`, e);
            }
          }
          return {
            hasConflict: conflicts.length > 0,
            conflicts,
          };
        } catch (e) {
          console.warn("衝突檢查失敗，繼續儲存", e);
          return { hasConflict: false };
        }
      }

      /* Gist 檔案 >1MB 會被 truncated，改走 raw_url 下載完整內容 */
      async function handleTruncatedFiles(files) {
        const processed = {};
        const truncatedList = [];

        for (const [name, file] of Object.entries(files || {})) {
          if (file.truncated && file.raw_url) {
            truncatedList.push({ name, raw_url: file.raw_url });
          } else {
            processed[name] = file;
          }
        }
        if (truncatedList.length > 0) {
          console.log(`[Gist] 偵測到 ${truncatedList.length} 個大型檔案被截斷，正在下載完整內容...`);
          ToastModule.show(`正在下載 ${truncatedList.length} 個大型檔案...`, "info");

          const downloads = await Promise.all(
            truncatedList.map(async ({ name, raw_url }) => {
              try {
                // 注意：raw_url 走 gist.githubusercontent.com（不經 Worker 代理）
                // Secret Gist 的 raw_url 本身已包含 hash 授權，不需 Authorization header
                const res = await fetch(raw_url + "?t=" + new Date().getTime());
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const content = await res.text();
                console.log(`[Gist] 已下載完整檔案: ${name} (${Math.round(content.length / 1024)}KB)`);
                return { name, content, success: true };
              } catch (e) {
                console.error(`[Gist] 下載 ${name} 失敗:`, e);
                return { name, success: false };
              }
            }),
          );

          downloads.forEach(({ name, content, success }) => {
            if (success) {
              processed[name] = { content, truncated: false };
            }
          });
        }
        return processed;
      }

      /* 應用程式設定 */
      const APP_CONFIG = { CREDENTIALS: [{ user: "admin", pass: "admin" }] };
      const PAGE_SIZE = 50;
      const SYNC_COOLDOWN = 30 * 1000;
      const CACHE_MAX_AGE = 5 * 60 * 1000;

      // ==========================================
      // 1.1 日期工具模組 (Date Utils Module)
      // ==========================================
      const DateUtils = (() => {
        const ZH_DATE_REGEX = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(上午|下午)\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/;

        /* 日期解析 */
        function parse(e) {
          if (!e) return null;
          if (e instanceof Date) return e;
          if ("number" == typeof e)
            return new Date(Math.round((e - 25569) * 864e5));
          if ("string" == typeof e) {
            let n = e.trim();
            if (n.includes("上午") || n.includes("下午")) {
              let r = n.match(ZH_DATE_REGEX);
              if (r) {
                let t = parseInt(r[5]);
                return (
                  "下午" === r[4] && t < 12 && (t += 12),
                  "上午" === r[4] && 12 === t && (t = 0),
                  new Date(
                    parseInt(r[1]),
                    parseInt(r[2]) - 1,
                    parseInt(r[3]),
                    t,
                    parseInt(r[6]),
                    parseInt(r[7]),
                  )
                );
              }
            }
            let l = n
                .replace(/上午/g, " AM")
                .replace(/下午/g, " PM")
                .replace(/\//g, "-")
                .replace(/\./g, "-"),
              i = new Date(l);
            return (
              isNaN(i.getTime()) && (i = new Date(n)),
              isNaN(i.getTime()) ? null : i
            );
          }
          return null;
        }

        /* 日期格式化 */
        function format(dateObj) {
          if (!dateObj || isNaN(dateObj.getTime())) return "";
          return `${dateObj.getFullYear()}/${(dateObj.getMonth() + 1).toString().padStart(2, "0")}/${dateObj.getDate().toString().padStart(2, "0")}`;
        }

        /* 日期顯示格式化 */
        function formatDisplay(dateStr) {
          return format(parse(dateStr));
        }

        /* 正規化月份 */
        function normalizeMonth(dateStr) {
          const d = parse(dateStr);
          return d
            ? `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`
            : null;
        }

        /* 正規化年份 */
        function normalizeYear(dateStr) {
          const d = parse(dateStr);
          return d ? `${d.getFullYear()}` : null;
        }

        /* 月份顯示格式化 */
        function formatMonthDisplay(t, n = false) {
          if (!t) return "";
          let r = t.split("-");
          return 2 === r.length
            ? n
              ? `${r[0]}-${r[1]} 月 `
              : `${parseInt(r[1])}月`
            : t;
        }

        /* 工作日計算（排除假日、含補班日，有起迄至少算 1 天） */
        function calcWorkDays(t, e) {
          let a = parse(t),
            g = parse(e);
          if (!a || !g) return "-";
          let r = new Date(a.getFullYear(), a.getMonth(), a.getDate()),
            l = new Date(g.getFullYear(), g.getMonth(), g.getDate()),
            n = false;
          r > l && (([r, l] = [l, r]), (n = true));

          let o = 0;
          for (let curr = new Date(r); curr <= l; ) {
            let D = curr.getDay(),
              u = `${curr.getFullYear()}${(curr.getMonth() + 1).toString().padStart(2, "0")}${curr.getDate().toString().padStart(2, "0")}`;
            if ((0 !== D && 6 !== D && !holidaySet.has(u)) || workdaySet.has(u)) o++;
            curr.setDate(curr.getDate() + 1);
          }
          // 有起有迄代表確實有工作行為，至少算 1 天
          if (o === 0) o = 1;
          return n ? -o : o;
        }

        /* 回傳今天日期字串 YYYYMMDD，適用於檔名 */
        function today() {
          return format(new Date()).replace(/\//g, '');
        }

        /* 驗證 yyyy/mm/dd 格式是否為合法日期 */
        function isValidDate(d) {
          if (!d) return false;
          const m = d.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
          if (!m) return false;
          const dt = new Date(`${m[1]}-${m[2]}-${m[3]}`);
          return !isNaN(dt.getTime());
        }

        /* 正規化日期字串（支援 yyyymmdd、yyyy-mm-dd、yyyy/m/d 等格式，輸出 yyyy/mm/dd） */
        function normalizeDateStr(raw) {
          if (!raw) return "";
          let s = raw.trim().replace(/-/g, "/");
          if (/^\d{8}$/.test(s)) s = `${s.slice(0,4)}/${s.slice(4,6)}/${s.slice(6,8)}`;
          s = s.replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, (_, y, m, d) =>
            `${y}/${m.padStart(2,'0')}/${d.padStart(2,'0')}`);
          return s;
        }

        // 公開 API
        return {
          parse,
          format,
          formatDisplay,
          normalizeMonth,
          normalizeYear,
          formatMonthDisplay,
          calcWorkDays,
          today,
          isValidDate,
          normalizeDateStr,
        };
      })();

      // ==========================================
      // 1.2 通知模組 (Toast Module)
      // ==========================================
      const ToastModule = (() => {
        const config = {
          success: { 
            bg: "bg-emerald-50", 
            border: "border-emerald-400",
            text: "text-emerald-700",
            icon: "circle-check",
            iconBg: "bg-emerald-100",
            iconColor: "text-emerald-500",
            progress: "bg-emerald-400"
          },
          error: { 
            bg: "bg-red-50", 
            border: "border-red-400",
            text: "text-red-700",
            icon: "circle-xmark",
            iconBg: "bg-red-100",
            iconColor: "text-red-500",
            progress: "bg-red-400"
          },
          warning: { 
            bg: "bg-amber-50", 
            border: "border-amber-400",
            text: "text-amber-700",
            icon: "triangle-exclamation",
            iconBg: "bg-amber-100",
            iconColor: "text-amber-500",
            progress: "bg-amber-400"
          },
          info: { 
            bg: "bg-blue-50", 
            border: "border-blue-400",
            text: "text-blue-700",
            icon: "circle-info",
            iconBg: "bg-blue-100",
            iconColor: "text-blue-500",
            progress: "bg-blue-400"
          }
        };

        function show(message, type = "info", duration = 1500) {
          const container = document.getElementById("toastContainer");
          if (!container) return;

          const c = config[type] || config.info;
          const toast = document.createElement("div");
          
          toast.className = `
            relative overflow-hidden min-w-[300px] max-w-md
            ${c.bg} ${c.border} border backdrop-blur-sm
            rounded-2xl shadow-xl shadow-black/5
            transform transition-all duration-300 ease-out
            -translate-y-4 opacity-0
          `;
          
          toast.innerHTML = `
            <div class="flex items-center gap-3 px-4 py-3">
              <div class="flex-shrink-0 w-8 h-8 ${c.iconBg} rounded-full flex items-center justify-center">
                <i class="fa-solid fa-${c.icon} ${c.iconColor}"></i>
              </div>
              <div class="flex-1 ${c.text} text-sm font-medium leading-snug">${message}</div>
              <button class="flex-shrink-0 ${c.text} opacity-50 hover:opacity-100 transition-opacity" onclick="this.closest('.toast-item')?.remove()">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div class="absolute bottom-0 left-0 h-1 ${c.progress} toast-progress" style="width: 100%"></div>
          `;
          
          toast.classList.add("toast-item");
          container.appendChild(toast);

          // 進入動畫
          requestAnimationFrame(() => {
            toast.classList.remove("-translate-y-4", "opacity-0");
          });

          // 進度條動畫
          const progressBar = toast.querySelector(".toast-progress");
          if (progressBar) {
            progressBar.style.transition = `width ${duration}ms linear`;
            requestAnimationFrame(() => {
              progressBar.style.width = "0%";
            });
          }

          // 自動移除
          const remove = () => {
            toast.classList.add("-translate-y-4", "opacity-0");
            setTimeout(() => toast.remove(), 300);
          };
          
          setTimeout(remove, duration);
          toast.addEventListener("click", (e) => {
            if (e.target.closest("button")) return;
            remove();
          });
        }

        return { show };
      })();

      // ==========================================
      // 1.3 日期選擇器管理模組 (Flatpickr Manager)
      // ==========================================
      const FlatpickrManager = (() => {
        const instances = new Map();
        const lazyCallbacks = new Map();  // 儲存延遲初始化的 callback

        /* 銷毀指定選擇器的所有實例 */
        function destroy(selector) {
          const list = instances.get(selector);
          if (list && list.length > 0) {
            list.forEach((fp) => {
              try {
                if (fp && typeof fp.destroy === "function") {
                  fp.destroy();
                }
              } catch (err) {
                console.warn("[Flatpickr] 銷毀實例時發生錯誤:", err);
              }
            });
            instances.delete(selector);
          }
        }

        /* 銷毀所有實例（含延遲初始化的標記） */
        function destroyAll() {
          instances.forEach((list, selector) => {
            destroy(selector);
          });
          // 清除延遲初始化標記
          document.querySelectorAll('.fp-lazy').forEach(el => {
            if (el._flatpickr) {
              try { el._flatpickr.destroy(); } catch(e) {}
            }
            el.classList.remove('fp-lazy');
            delete el.dataset.fpSelector;
          });
          lazyCallbacks.clear();
        }

        /* 延遲初始化 - 只標記，不立即建立 Flatpickr */
        function init(selector, updateFn) {
          lazyCallbacks.set(selector, updateFn);
          
          document.querySelectorAll(selector).forEach((input) => {
            if (!input.classList.contains('fp-lazy')) {
              input.classList.add('fp-lazy');
              input.dataset.fpSelector = selector;
              input.style.cursor = isLoggedIn ? 'pointer' : 'default';
            }
          });
        }

        /* 實際初始化單一 input 的 Flatpickr（點擊時呼叫） */
        function initSingle(input) {
          if (input._flatpickr) return input._flatpickr;
          const selector = input.dataset.fpSelector;
          const updateFn = lazyCallbacks.get(selector);
          if (!updateFn) {
            console.warn('[Flatpickr] 找不到對應的 callback:', selector);
            return null;
          }
          const defaultValue = input.value || null;
          // 隱藏全為跨月日期的多餘列
          function trimExtraWeekRow(container) {
            if (!container) return;
            // 分組成每 7 個一列
            const days = Array.from(container.querySelectorAll('.flatpickr-day'));
            for (let i = 0; i < days.length; i += 7) {
              const row = days.slice(i, i + 7);
              const allOtherMonth = row.every(d =>
                d.classList.contains('nextMonthDay') || d.classList.contains('prevMonthDay')
              );
              row.forEach(d => {
                d.style.display = allOtherMonth ? 'none' : '';
              });
            }
          }

          const fp = flatpickr(input, {
            dateFormat: "Y/m/d",
            locale: "zh_tw",
            allowInput: isLoggedIn,
            clickOpens: isLoggedIn,
            defaultDate: defaultValue,
            minDate: "2000-01-01",
            maxDate: "2099-12-31",
            position: "below",
            appendTo: document.body,
            onOpen: function () {
              if (!isLoggedIn) {
                this.close();
                return;
              }
              const rect = this.input.getBoundingClientRect();
              this.calendarContainer.style.position = "fixed";
              this.calendarContainer.style.left = rect.right + 5 + "px";
              this.calendarContainer.style.top = rect.top + "px";
              trimExtraWeekRow(this.calendarContainer);
            },
            onMonthChange: function () {
              trimExtraWeekRow(this.calendarContainer);
            },
            onYearChange: function () {
              trimExtraWeekRow(this.calendarContainer);
            },
            onClose: function (selectedDates, dateStr) {
              if (isLoggedIn) {
                let finalValue = this.input.value !== dateStr ? this.input.value : dateStr;
                if (finalValue && finalValue !== "取消") {
                  const formatted = DateUtils.formatDisplay(finalValue);
                  if (formatted) {
                    finalValue = formatted;
                    this.input.value = formatted;
                  }
                }
                updateFn(this.input, finalValue);
              }
            },
          });
          if (!instances.has(selector)) {
            instances.set(selector, []);
          }
          instances.get(selector).push(fp);
          return fp;
        }

        /* 取得實例 Map（供除錯用） */
        function getInstances() {
          return instances;
        }

        return { init, initSingle, destroy, destroyAll, getInstances, lazyCallbacks };
      })();

      // 點擊時初始化 Flatpickr
      document.addEventListener('focusin', function(e) {
        const input = e.target;
        if (input.classList.contains('fp-lazy') && !input._flatpickr && isLoggedIn) {
          const fp = FlatpickrManager.initSingle(input);
          if (fp) {
            setTimeout(() => fp.open(), 10);
          }
        }
      });

      // 處理手動輸入（適用於 Flatpickr 尚未初始化時的直接輸入）
      document.addEventListener('change', function(e) {
        const input = e.target;
        if (input.classList.contains('fp-lazy') && isLoggedIn) {
          const selector = input.dataset.fpSelector;
          const updateFn = FlatpickrManager.lazyCallbacks?.get(selector);
          if (updateFn) {
            let value = input.value;
            if (value && value !== "取消") {
              const formatted = DateUtils.formatDisplay(value);
              if (formatted) {
                value = formatted;
                input.value = formatted;
              }
            }
            updateFn(input, value);
          }
        }
      });

      // ==========================================
      // 2. 工具函式庫 (Utility Library)
      // ==========================================

      const Utils = {
        /* 記錄哪些選單已經初始化過 */
        _initializedSelectors: new Set(),

        /* 去除字串中所有半形/全形括號及其內容 */
        stripParens(s) {
          return (s || "").replace(/[\(（][^)）]*[\)）]/g, "").trim();
        },

        /* 防抖動函式 */
        debounce(fn, delay = 300) {
          let t;
          return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), delay);
          };
        },

        /* 帶重試的 Fetch */
        async fetchWithRetry(url, opts = {}, retries = 3, delay = 1000) {
          for (let i = 0; i < retries; i++) {
            try {
              const res = await fetch(url, opts);
              if (res.ok) return res;
              if (res.status >= 500 && i < retries - 1) {
                await new Promise((r) => setTimeout(r, delay));
                continue;
              }
              return res;
            } catch (e) {
              if (i === retries - 1) throw e;
              await new Promise((r) => setTimeout(r, delay));
            }
          }
        },

        /* 權限屬性生成 */
        authAttrs() {
          return {
            ro: isLoggedIn ? "" : "readonly",
            dis: isLoggedIn ? "" : "disabled",
            inputCls: isLoggedIn ? "table-input" : "table-input bg-transparent border-none cursor-default",
            txtCls: isLoggedIn ? "table-input w-full overflow-hidden resize-none leading-relaxed text-xs" : "table-input w-full overflow-hidden resize-none leading-relaxed bg-transparent border-none cursor-default text-xs",
            selectCls: isLoggedIn ? "table-input" : "table-input bg-transparent border-none appearance-none",
          };
        },

        /* 年份選擇器初始化 */
        initYearSelect(e, t, l = "年", includeAll = true) {
          let n = document.getElementById(e);
          if (!n) return t[0] || new Date().getFullYear().toString();

          let r = n.value,
            a = [...new Set(t)].sort().reverse();
          a.length || a.push(new Date().getFullYear().toString());
          let options = includeAll ? ["ALL", ...a] : a;

          let i = n.options.length !== options.length || [...n.options].some((e, t) => e.value !== options[t]);
          if (i) {
            n.innerHTML = options.map((e) => (e === "ALL" ? `<option value="ALL">全部年度</option>` : `<option value="${e}">${e} ${l}</option>`)).join("");
          }
          if (this._initializedSelectors.has(e)) {
            if (r && options.includes(r)) {
              n.value = r;
            } else {
              n.value = a[0];
            }
          } else {
            n.value = a[0];
            this._initializedSelectors.add(e);
          }
          return n.value;
        },


        /* Textarea 自動調整 */
        _fieldSizingSupported: null,
        autoResize(e) {
          if (!e) return;
          if (this._fieldSizingSupported === null) this._fieldSizingSupported = CSS.supports("field-sizing", "content");
          if (this._fieldSizingSupported) return;
          e.style.overflow = "hidden";
          const c = e.clientHeight,
            s = e.scrollHeight;
          if (s > c) e.style.height = s + "px";
        },

        /* 通用排序邏輯
           - 空值永遠排最後 (不受 asc/desc 影響)
           - 日期欄位用 Date 物件比較 (容錯手改 GIST 時用了不同分隔符 -/) */
        sortData: (e, t, l) =>
          e.sort((e, n) => {
            let r = e[t], a = n[t];
            if (r == null) r = "";
            if (a == null) a = "";
            if (r === a) return 0;
            if (r === "") return 1;
            if (a === "") return -1;
            const isDateLike = (s) => /^\d{4}[-\/]\d/.test(String(s));
            if (isDateLike(r) && isDateLike(a)) {
              const dr = DateUtils.parse(r), da = DateUtils.parse(a);
              if (dr && da) return l ? dr - da : da - dr;
            }
            let i = Number(r), o = Number(a);
            return isNaN(i) || isNaN(o) || "" === String(r).trim() || "" === String(a).trim()
              ? (l ? String(r).localeCompare(String(a), "zh-Hant") : String(a).localeCompare(String(r), "zh-Hant"))
              : l ? i - o : o - i;
          }),

        formatPartNo(str) {
          if (!str) return "";
          // \u4f9d\u63db\u884c\u5206\u884c\uff0c\u907f\u514d\u7a7a\u683c\u5206\u8a5e\u62c6\u65b7\u6599\u865f
          return String(str)
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => this.escapeHtml(l))
            .join("<br>");
        },

        /* 排序圖示 */
        getSortIcon: (e, t) => (e ? (t ? '<i class="fa-solid fa-arrow-down-a-z text-ms-blue ml-1 text-xs"></i>' : '<i class="fa-solid fa-arrow-down-z-a text-ms-blue ml-1 text-xs"></i>') : '<i class="fa-solid fa-arrows-up-down text-gray-300 ml-1"></i>'),

        /* HTML 跳脫 - 避免特殊字元破壞屬性值 */
        escapeHtml: (str) => {
          if (str == null) return "";
          return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        },

        /* 判斷資料行是否為空白 */
        isRowBlank(row) {
            if (!row) return true;
            const ignoreValues = new Set([
                "", null, undefined,
                "進行中", "一般", "-", "Y", "N",
                "ECN", "ECR"
            ]);
            const ignoreKeys = new Set([
                "_idx", "_origIdx", "_search_approve", "week",
                "kpi1", "kpi2", "kpi3"
            ]);
            for (const [key, val] of Object.entries(row)) {
                if (ignoreKeys.has(key)) continue;
                const strVal = String(val ?? "").trim();
                if (!ignoreValues.has(strVal)) return false;
            }
            return true;
        },

        /* 移除無效/空白資料行 */
        removeInvalidRows(data) {
          if (!Array.isArray(data)) return;
          const ignoreValues = new Set([
            "", null, undefined,
            "進行中", "一般", "-", "Y", "N",
          ]);
          const ignoreKeys = new Set([
            "_idx", "_origIdx", "_search_approve", "week", 
            "kpi1", "kpi2", "kpi3" 
          ]);
          for (let i = data.length - 1; i >= 0; i--) {
            const row = data[i];
            let hasData = false;
            for (const [key, val] of Object.entries(row)) {
              if (ignoreKeys.has(key)) continue; 
              
              const strVal = String(val ?? "").trim();
              if (!ignoreValues.has(strVal)) {
                hasData = true;
                break;
              }
            }
            if (!hasData) {
              data.splice(i, 1);
            }
          }
        },
      };

      // ==========================================
      // 2.5 通用搜尋模組 (Search Module)
      // ==========================================

      const SearchModule = {
        // ===== 欄位配置 =====
        fieldConfig: {
          p1: { fields: ["id", "ecrId", "partNo", "applicant", "approver", "scope", "changeReason", "overdueNote", "status", "priority", "complexity", "_closeDays", "_ecWorkDays", "_isOverdue", "applyTime", "approveTime", "approveTime1", "transferDate", "plmStart", "plmRelease"] },
          p10: { fields: ["formId", "dept", "applicant", "step", "arriveDate", "result", "approveDate", "executor", "comment"] },
          p5: { fields: ["partNo", "_stage", "projectCode", "applicant", "hasBom", "bomDate", "creator", "priority", "applyDate", "updateDate", "createDate", "_workDays", "_isOverdue", "overdueNote"] },
          p3: { fields: ["id", "partNo", "applicant", "name2", "time2", "time3", "updateDate1", "kpi1", "_overdue1", "note1", "name7", "time7", "name8", "time8", "updateDate2", "kpi2", "_overdue2", "note2", "_search_approve", "name13", "time13", "name15", "time15", "status", "priority", "_isOverdue", "_allNotes"] },
          p9: { fields: ["partNo", "maintainer", "type", "category", "date"] },
          p8: { fields: ["pcbNo", "partNo", "maintainer", "note", "date"] },
          p12: { fields: ["content", "person", "note", "category", "date"] },
          p14: { fields: ["date", "ecnNo", "tier", "partNo", "executor", "note"] },
          p17: { fields: ["applicant", "unit", "partNo", "_stage", "executor", "priority", "overdueNote", "receiveDate", "updateDate", "completeDate", "_workDays", "_isOverdue"] },
          p19: { fields: ["date", "applicant", "unit", "content", "executor", "note"] },
          p20: { fields: ['ecrSerial','ecrApplicantDept','ecrApplicant','ecrApplyTime','ecrStatusText','ecrSignInfo','ecrStep7Time','ecrDuration','ecnSerial','ecnApplicantDept','ecnApplicant','ecnApplyTime','ecnStatusText','ecnSignInfo','ecnStep2Time','ecnDuration'] }
        },

        // ===== 欄位別名 =====
        fieldAliasMap: {
          p1: {
            "ECN單號": "id", "ECN": "id",
            "ECR單號": "ecrId", "ECR": "ecrId",
            "表單狀態": "status", "狀態": "status",
            "申請人": "applicant", "變更品號": "partNo", "品號": "partNo",
            "協辦人": "approver",
            "需求等級": "priority", "等級": "priority",
            "變更範圍": "scope", "範圍": "scope",
            "變更原因分類": "changeReason", "原因": "changeReason",
            "申請日期": "applyTime", "申請日": "applyTime",
            "【一】申請": "approveTime1", "一申請": "approveTime1",
            "【二】協辦": "approveTime", "二協辦": "approveTime",
            "全流程": "_closeDays", "天數": "_closeDays", 
            "【二】收件日": "transferDate", "二收件": "transferDate",
            "複雜度": "complexity", "PLM發起": "plmStart", "PLM發佈": "plmRelease",
            "EC天數":"_ecWorkDays",
            "逾期": "_isOverdue", "逾期說明": "overdueNote", "說明": "overdueNote"
          },
          p10: {
            "表單編號": "formId", "單號": "formId",
            "申請部門": "dept", "部門": "dept",
            "申請人": "applicant", "執行人": "executor",
            "送達日期": "arriveDate", "送達日": "arriveDate",
            "簽核結果": "result",
            "簽核日期": "approveDate", "簽核日": "approveDate",
            "簽核意見": "comment", "意見": "comment"
          },
          p5: {
            "申請日期": "applyDate", "申請日": "applyDate",
            "更新日期": "updateDate", "更新日": "updateDate",
            "建立日期": "createDate", "建立日": "createDate",
            "板階料號": "partNo", "料號": "partNo",
            "階段": "_stage", "專案代碼": "projectCode",
            "申請人": "applicant", "是否有BOM": "hasBom", "BOM?": "hasBom",
            "BOM發佈日": "bomDate", "建立人": "creator",
            "需求等級": "priority", "等級": "priority",
            "工作天數": "_workDays", "天數": "_workDays",
            "逾期": "_isOverdue", "逾期說明": "overdueNote", "說明": "overdueNote"
          },
          p3: {
            "PCB單號": "id", "單號": "id", "PCB料號": "partNo", "料號": "partNo",
            "狀態": "status", "申請人": "applicant", "需求等級": "priority", "等級": "priority",
            "【二】部門主管": "name2", "二關": "name2",
            "【三】工程中心": "name3", "三關": "name3", "【三】簽核日": "time3", "三簽": "time3",
            "3更新": "updateDate1", "KPI1": "kpi1", "3逾期": "_overdue1", "3說明": "note1",
            "【八】工程中心": "name8", "八關": "name8", " 【八】簽核日": "time8", "八簽": "time8",
            "8更新": "updateDate2", "KPI2": "kpi2", "8逾期": "_overdue2", "8說明": "note2",
            "承認PCB": "_search_approve", "承認": "_search_approve",
            "【十五】工程中心": "name13", "十五關": "name13", "【十五】簽核日": "time13", "十五簽": "time13",
            "【十八】工程中心": "name15", "十八關": "name15","【十八】簽核日": "time15", "十八簽": "time15",
            "KPI3": "kpi3", 
            "逾期": "_isOverdue", "說明": "_allNotes"
          },
          p9: {
            "維護日期": "date", "維護日": "date",
            "PCB料號": "partNo", "料號": "partNo",
            "維護人": "maintainer", "類別": "type", "備註": "category"
          },
          p8: {
            "啟動日期": "date", "啟動日": "date",
            "PCB單號": "pcbNo", "單號": "pcbNo",
            "PCB料號": "partNo", "料號": "partNo",
            "執行人": "maintainer", "備註": "note"
          },
          p12: {
            "日期": "date", "類別": "category", "內容": "content",
            "執行人": "person", "備註": "note"
          },
          p14: {
            "日期": "date", "ECN單號": "ecnNo", "ECN": "ecnNo",
            "階層": "tier", "料號": "partNo", "執行人": "executor", "備註": "note"
          },
          p17: {
            "收件日期": "receiveDate", "收件日": "receiveDate",
            "更新日期": "updateDate", "更新日": "updateDate",
            "申請人": "applicant", "單位": "unit",
            "料號": "partNo", "階段": "_stage", "需求等級": "priority", "等級": "priority",
            "完成日期": "completeDate", "完成日": "completeDate", "執行人": "executor",
            "工作天數": "_workDays", "天數": "_workDays",
            "逾期": "_isOverdue", "逾期說明": "overdueNote", "說明": "overdueNote"
          },
          p19: {
            "日期": "date",
            "申請人": "applicant",
            "申請單位": "unit", "單位": "unit",
            "內容": "content",
            "執行人": "executor",
            "備註": "note"
          },
          p20: {
            'ECR單號':'ecrSerial', 'ECR':'ecrSerial',
            'ECR狀態':'ecrStatusText', 'ECR申請部門':'ecrApplicantDept', 'ECR部門':'ecrApplicantDept', 'ECR申請人':'ecrApplicant',
            'ECR簽核':'ecrSignInfo',
            'ECR申請日':'ecrApplyTime', 'ECR結案日':'ecrStep7Time',
            'ECR天數':'ecrDuration',
            'ECN單號':'ecnSerial', 'ECN':'ecnSerial',
            'ECN狀態':'ecnStatusText', 'ECN申請部門':'ecnApplicantDept', 'ECN部門':'ecnApplicantDept', 'ECN申請人':'ecnApplicant',
            'ECN簽核':'ecnSignInfo',
            'ECN申請日':'ecnApplyTime', 'ECN二關':'ecnStep2Time',
            'ECN天數':'ecnDuration'
          }
        },

        // ===== 解析進階搜尋語法 =====
        parseAdvancedSearch(input, pageKey) {
          const result = {
            fieldFilters: [],
            excludeFilters: [],
            globalKeywords: [],
            dateRanges: [],
            fieldExists: []
          };
          if (!input || !input.trim()) return result;

          const aliasMap = this.fieldAliasMap[pageKey] || {};
          const allAliases = Object.keys(aliasMap).sort((a, b) => b.length - a.length);

          let remaining = input;
          let isExclude = false;
          let currentField = null;
          let currentTokens = [];

          const saveCurrentFilter = () => {
            if (currentTokens.length === 0) {
              if (currentField) {
                if (isExclude) {
                  result.excludeFilters.push({ field: currentField, value: null, excludeExists: true });
                } else {
                  result.fieldExists.push(currentField);
                }
              }
              currentField = null;
              isExclude = false;
              return;
            }
            const rawValue = currentTokens.join(" ").trim();
            if (!rawValue) {
              currentField = null;
              isExclude = false;
              return;
            }
            if (currentField) {
              const filter = this.parseFieldValue(rawValue, currentField);
              if (isExclude) {
                result.excludeFilters.push({ field: currentField, filter });
              } else if (filter.dateRange) {
                result.dateRanges.push({ field: currentField, start: filter.dateRange.start, end: filter.dateRange.end });
              } else {
                result.fieldFilters.push(filter);
              }
            } else {
              if (isExclude) {
                result.excludeFilters.push({ field: null, value: rawValue.toLowerCase() });
              } else {
                result.globalKeywords.push(...rawValue.toLowerCase().split(/\s+/).filter(k => k));
              }
            }
            currentTokens = [];
            currentField = null;
            isExclude = false;
          };

          while (remaining.length > 0) {
            remaining = remaining.trimStart();
            if (!remaining) break;

            if (remaining.startsWith("!")) {
              saveCurrentFilter();
              isExclude = true;
              currentField = null;
              remaining = remaining.slice(1).trimStart();
              continue;
            }

            let matchedAlias = null;
            for (const alias of allAliases) {
              if (remaining.startsWith(alias)) {
                const nextChar = remaining[alias.length];
                if (!nextChar || /\s/.test(nextChar)) {
                  matchedAlias = alias;
                  break;
                }
              }
            }

            if (matchedAlias) {
              const wasExclude = isExclude;
              saveCurrentFilter();
              currentField = aliasMap[matchedAlias];
              remaining = remaining.slice(matchedAlias.length).trimStart();
              isExclude = wasExclude;
            } else {
              const spaceIdx = remaining.search(/\s/);
              const token = spaceIdx === -1 ? remaining : remaining.slice(0, spaceIdx);
              remaining = spaceIdx === -1 ? "" : remaining.slice(spaceIdx);
              currentTokens.push(token);
            }
          }
          saveCurrentFilter();
          return result;
        },

        // ===== 解析欄位值 =====
        parseFieldValue(rawValue, field) {
          const result = { field, value: "", orValues: [], compare: null, dateRange: null };

          const dateRangeMatch = rawValue.match(/^(\d{4}\/\d{1,2}(?:\/\d{1,2})?)~(\d{4}\/\d{1,2}(?:\/\d{1,2})?)$/);
          if (dateRangeMatch) {
            const normDate = (s) => {
              const p = s.split('/');
              return p[0] + '-' + p[1].padStart(2,'0') + (p[2] ? '-' + p[2].padStart(2,'0') : '');
            };
            result.dateRange = { start: normDate(dateRangeMatch[1]), end: normDate(dateRangeMatch[2]) };
            return result;
          }

          const compareMatch = rawValue.match(/^([><=]{1,2})(\d+(?:\.\d+)?)$/);
          if (compareMatch) {
            result.compare = { operator: compareMatch[1], value: parseFloat(compareMatch[2]) };
            return result;
          }

          if (rawValue.includes("|")) {
            result.orValues = rawValue.split("|").map(p => p.trim().toLowerCase());
            return result;
          }

          result.value = rawValue.toLowerCase();
          return result;
        },

        // ===== 進階比對 =====
        matchItemAdvanced(item, parsed, fields, pageKey) {
          const matchFilter = (filter, itemValue) => {
            const itemStr = itemValue != null ? String(itemValue).toLowerCase() : "";

            if (filter.dateRange) {
              if (!itemValue) return false;
              const itemDate = typeof itemValue === "string" ? itemValue.replace(/\//g, "-") : "";
              const startDate = filter.dateRange.start.length === 7 ? filter.dateRange.start + "-01" : filter.dateRange.start;
              const endDate = filter.dateRange.end.length === 7 ? filter.dateRange.end + "-31" : filter.dateRange.end;
              return itemDate >= startDate && itemDate <= endDate;
            }

            if (filter.compare) {
              const num = parseFloat(itemValue);
              if (isNaN(num)) return false;
              const { operator, value } = filter.compare;
              switch (operator) {
                case ">": return num > value;
                case ">=": return num >= value;
                case "<": return num < value;
                case "<=": return num <= value;
                case "=": return num === value;
              }
              return false;
            }

            // 日期搜尋容錯：YYYY/MM/DD 與 YYYY-MM-DD 互通
            const normDate = (s) => /^\d{4}[\/\-]\d/.test(s) ? s.replace(/\//g, "-") : s;
            const itemNorm = itemStr.includes("/") || itemStr.includes("-") ? itemStr.replace(/\//g, "-") : itemStr;

            if (filter.orValues.length > 0) {
              return filter.orValues.some(ov => itemNorm.includes(normDate(ov)));
            }

            return itemNorm.includes(normDate(filter.value));
          };

          // 通用 OR 比對
          const matchOrKeyword = (kw, str) => {
            if (kw.includes('|')) {
              return kw.split('|').filter(p => p).some(p => str.includes(p));
            }
            return str.includes(kw);
          };
          for (const field of parsed.fieldExists) {
            const val = item[field];
            if (val == null || val === "" || val === "-") {
              return false;
            }
          }

          // 排除條件
          for (const exclude of parsed.excludeFilters) {
            if (exclude.excludeExists) {
              const val = item[exclude.field];
              if (val != null && val !== "" && val !== "-") {
                return false;
              }
            } else if (exclude.filter) {
              if (matchFilter(exclude.filter, item[exclude.field])) {
                return false;
              }
            } else if (exclude.field === null) {
              const found = fields.some(field => {
                const val = item[field];
                if (!val) return false;
                return matchOrKeyword(exclude.value, String(val).toLowerCase());
              });
              if (found) return false;
            } else {
              const itemValue = item[exclude.field];
              if (itemValue && matchOrKeyword(exclude.value, String(itemValue).toLowerCase())) {
                return false;
              }
            }
          }

          // 日期範圍
          for (const range of parsed.dateRanges) {
            const itemValue = item[range.field];
            if (!itemValue) return false;
            const itemDate = typeof itemValue === "string" ? itemValue.replace(/\//g, "-") : "";
            const startDate = range.start.length === 7 ? range.start + "-01" : range.start;
            const endDate = range.end.length === 7 ? range.end + "-31" : range.end;
            if (itemDate < startDate || itemDate > endDate) return false;
          }

          // 欄位條件（使用通用 matchFilter）
          for (const filter of parsed.fieldFilters) {
            if (!matchFilter(filter, item[filter.field])) return false;
          }

          // 全域關鍵字
          for (const kw of parsed.globalKeywords) {
            const found = fields.some(field => {
              const val = item[field];
              if (!val) return false;
              return matchOrKeyword(kw, String(val).toLowerCase());
            });
            if (!found) return false;
          }

          return true;
        },

        // ===== 過濾資料 =====
        filterData(data, pageKey, keyword, crossYear = false, yearFilter = null) {
          const config = this.fieldConfig[pageKey];
          if (!config) return data;

          let filtered = data;
          if (!crossYear && yearFilter) {
            filtered = filtered.filter(yearFilter);
          }

          if (keyword && keyword.trim()) {
            const parsed = this.parseAdvancedSearch(keyword, pageKey);
            filtered = filtered.filter(item => this.matchItemAdvanced(item, parsed, config.fields, pageKey));
          }

          return filtered;
        },

        // ===== 建立防抖搜尋函數 =====
        createDebouncedSearch(pageKey, renderFn, delay = 250) {
          return Utils.debounce(() => {
            paginationState[pageKey] = 1;
            renderFn();
          }, delay);
        }
      };

      // ===== 動態搜尋語法說明 =====
      const SEARCH_HELP_PAGE_NAME = {
        p1:'ECN 詳細清單', p20:'ECR/ECN 追蹤報告', p10:'轉單清單',
        p5:'新建板階清單', p3:'PCB 詳細清單', p9:'PCB 維護清單',
        p8:'GPMS 啟動清單', p12:'協助項目', p14:'停用替代', p17:'BOM 建立', p19:'管制文件申請'
      };

      // 每頁的情境範例：[搜尋語法, 說明]
      const SEARCH_HELP_EXAMPLES = {
        p1: {
          basic: [
            ['王小明',        '全欄位模糊搜尋'],
            ['!王小明',       '全欄位排除含「王小明」的資料'],
            ['協辦人 王小明',  '搜尋協辦人含「王小明」'],
            ['等級 急件|一般',  '需求等級為急件或一般'],
            ['申請日 YYYY/MM/DD',  '搜尋指定的申請日期'],
          ],
          advanced: [
            ['逾期',                       '篩選有逾期的資料'],
            ['!狀態 同意結束',              '排除「同意結束」的表單狀態'],
            ['天數 &gt;20',               '全流程大於 20 天'],
            ['申請日 YYYY/MM~YYYY/MM',    '申請日期在此範圍內'],
          ],
          combo: [
            ['協辦人 王小明|陳小美 逾期',             '王小明或陳小美的逾期項目'],
            ['狀態 進行中 !協辦人 王小明',      '進行中但協辦人非王小明'],
            ['天數 &gt;20 等級 急件',          '急件且全流程超過 20 天'],
          ]
        },
        p20: {
          basic: [
            ['王小明',           '全欄位模糊搜尋（ECR + ECN）'],
            ['!王小明',          '全欄位排除含「王小明」的資料'],
            ['ECR申請人 王小明',  '搜尋 ECR 申請人含「王小明」'],
            ['ECN狀態 進行中|同意結束',    '搜尋 ECN 狀態為進行中或同意結束'],
            ['ECR申請日 YYYY/MM/DD',  '搜尋指定的 ECR 申請日期'],
          ],
          advanced: [
            ['ECN二關',                       '篩選 ECN【二】協辦有時間的資料'],
            ['!ECN二關',                      '排除 ECN【二】協辦<b>沒有</b>時間的資料'],
            ['ECR天數 &gt;30',                'ECR 流程耗時超過 30 天'],
            ['ECR申請日 YYYY/MM~YYYY/MM',     'ECR 申請日在此範圍內'],
          ],
          combo: [
            ['ECN狀態 進行中 !ECN二關',           'ECN 進行中且【二】協辦未完成'],
            ['ECR申請人 王小明 ECR天數 &gt;20',   '王小明的 ECR 且流程耗時超過 20 天'],
            ['ECR狀態 進行中 ECN狀態 進行中',      'ECR 與 ECN 都還在進行中'],
          ]
        },
        p10: {
          basic: [
            ['王小明',        '全欄位模糊搜尋'],
            ['!王小明',       '排除含「王小明」的資料'],
            ['執行人 王小明',  '搜尋執行人含「王小明」'],
            ['意見 ABC|DEF',      '搜尋簽核意見含「ABC」或「DEF」'],
            ['簽核日 YYYY/MM/DD',  '搜尋指定的簽核日期'],
          ],
          advanced: [
            ['送達日 YYYY/MM~YYYY/MM',    '送達日期在此範圍內'],
            ['!簽核結果 同意',              '排除簽核結果為同意'],
          ],
          combo: [
            ['執行人 王小明 意見 ABC',  '王小明且簽核意見含「ABC」的項目'],
            ['執行人 王小明 !簽核結果 同意',     '王小明且簽核結果未同意'],
          ]
        },
        p5: {
          basic: [
            ['王小明',        '全欄位模糊搜尋'],
            ['!王小明',       '排除含「王小明」的資料'],
            ['建立人 王小明',  '搜尋建立人含「王小明」'],
            ['等級 急件|一般', '需求等級為急件或一般'],
            ['申請日 YYYY/MM/DD',  '搜尋指定的申請日期'],
          ],
          advanced: [
            ['逾期',                       '篩選有逾期的資料'],
            ['天數 &gt;10',               '工作天數超過 10 天'],
            ['申請日 YYYY/MM~YYYY/MM',    '申請日期在此範圍內'],
          ],
          combo: [
            ['建立人 王小明 逾期',           '王小明建立且逾期的'],
            ['等級 急件 天數 &gt;5',         '急件且工作天數超過 5 天'],
          ]
        },
        p3: {
          basic: [
            ['王小明',       '全欄位模糊搜尋'],
            ['!王小明',      '排除含「王小明」的資料'],
            ['申請人 王小明', '搜尋填單人含「王小明」'],
            ['等級 緊急|高',     '搜尋需求等級為緊急或高'],
          ],
          advanced: [
            ['逾期',           '篩選有逾期的資料'],
            ['KPI1 &gt;10',   '【二→三】(KPI1) 工作天數超過 10 天'],
            ['!狀態 結案',     '排除已結案的'],
          ],
          combo: [
            ['申請人 王小明 逾期',        '王小明的逾期項目'],
            ['狀態 進行中 等級 急件',      '進行中的急件'],
          ]
        },
        p9: {
          basic: [
            ['王小明',        '全欄位模糊搜尋'],
            ['維護人 王小明',  '搜尋維護人含「王小明」'],
            ['!料號 ABC',    '排除PCB 料號含「ABC」的資料'],
            ['類別 其他|定版',      '搜尋類別含「其他」或「定版」'],
            ['維護日 YYYY/MM/DD',  '搜尋指定的維護日期'],
          ],
          advanced: [
            ['維護日 YYYY/MM~YYYY/MM',    '維護日在此範圍內'],
          ],
          combo: [
            ['維護人 王小明 類別 定版',    '王小明的定版項目'],
            ['料號 ABC 類別 申請單留底|定版',    '料號ABC類別為申請單留底或定版'],
          ]
        },
        p8: {
          basic: [
            ['王小明',        '全欄位模糊搜尋'],
            ['執行人 王小明',  '搜尋執行人含「王小明」'],
            ['!料號 ABC',  '排除PCB 料號含「ABC」的資料'],
            ['啟動日 YYYY/MM/DD',  '搜尋指定的啟動日期'],
          ],
          advanced: [
            ['啟動日 YYYY/MM~YYYY/MM',    '啟動日在此範圍內'],
          ],
          combo: [
            ['執行人 王小明 啟動日 YYYY/MM~YYYY/MM', '王小明在該期間啟動的'],
          ]
        },
        p12: {
          basic: [
            ['王小明',        '全欄位模糊搜尋'],
            ['執行人 王小明',  '搜尋執行人含「王小明」'],
            ['類別 跨部門',      '搜尋類別含「跨部門」'],
            ['日期 YYYY/MM/DD',  '搜尋指定的日期'],
          ],
          advanced: [
            ['日期 YYYY/MM~YYYY/MM',  '日期在此範圍內'],
          ],
          combo: [
            ['執行人 王小明 類別 跨部門', '王小明的跨部門項目'],
          ]
        },
        p14: {
          basic: [
            ['王小明',        '全欄位模糊搜尋'],
            ['執行人 王小明',  '搜尋執行人含「王小明」'],
            ['ECN 123',         '搜尋 ECN 單號含「123」'],
            ['日期 YYYY/MM/DD',  '搜尋指定的日期'],
          ],
          advanced: [
            ['日期 YYYY/MM~YYYY/MM',  '日期在此範圍內'],
          ],
          combo: [
            ['執行人 王小明 階層 9',   '王小明處理的 9 階'],
          ]
        },
        p17: {
          basic: [
            ['王小明',        '全欄位模糊搜尋'],
            ['!王小明',       '排除含「王小明」的資料'],
            ['執行人 王小明',  '搜尋執行人含「王小明」'],
            ['等級 急件|一般', '需求等級為急件或一般'],
            ['完成日 YYYY/MM/DD',  '搜尋指定的完成日期'],
          ],
          advanced: [
            ['逾期',                       '篩選有逾期的資料'],
            ['天數 &gt;10',               '工作天數超過 10 天'],
            ['收件日 YYYY/MM~YYYY/MM',    '收件日在此範圍內'],
          ],
          combo: [
            ['執行人 王小明 逾期',         '王小明的逾期項目'],
            ['等級 急件 天數 &gt;5',       '急件且超過 5 天'],
          ]
        },
        p19: {
          basic: [
            ['王小明',           '全欄位模糊搜尋'],
            ['!王小明',          '排除含「王小明」的資料'],
            ['內容 123',     '搜尋內容含「123」'],
            ['申請單位 A|B',   '搜尋申請單位為 A 或 B'],
            ['日期 YYYY/MM/DD',  '搜尋指定的申請日期'],
          ],
          advanced: [
            ['日期 YYYY/MM~YYYY/MM',  '申請日期在此範圍內'],
            ['!備註',                 '排除有備註的資料'],
          ],
          combo: [
            ['執行人 王小明 申請單位 ISW',  '王小明承辦且申請單位為 ISW'],
            ['申請人 王小明 日期 YYYY/MM~YYYY/MM',  '王小明在該期間申請的'],
          ]
        }
      };

      /* 開啟搜尋語法說明 */
      function showSearchHelp(pageKey) {
        const name = SEARCH_HELP_PAGE_NAME[pageKey] || '';
        const examples = SEARCH_HELP_EXAMPLES[pageKey] || SEARCH_HELP_EXAMPLES.p1;

        // 標題
        document.getElementById('searchHelpTitle').innerHTML =
          `<i class="fa-solid fa-magnifying-glass"></i> 搜尋語法說明`;

        // 從 fieldAliasMap 自動產生可用搜尋欄位（最短別名）
        const aliasMap = SearchModule.fieldAliasMap[pageKey] || {};
        const fieldShortest = {};
        for (const [alias, field] of Object.entries(aliasMap)) {
          if (!fieldShortest[field] || alias.length < fieldShortest[field].length) {
            fieldShortest[field] = alias;
          }
        }
        const aliases = Object.values(fieldShortest);
        const aliasChips = aliases.map(a =>
          `<span style="display:inline-block;padding:2px 8px;margin:2px;font-size:12px;font-family:monospace;background:#f0f4ff;color:#1e40af;border:1px solid #bfdbfe;border-radius:4px;cursor:pointer;transition:all .15s" onclick="navigator.clipboard.writeText('${a}');this.style.background='#dcfce7';this.style.color='#166534';this.style.borderColor='#86efac';setTimeout(()=>{this.style.background='#f0f4ff';this.style.color='#1e40af';this.style.borderColor='#bfdbfe'},800)" title="點擊複製">${a}</span>`
        ).join('');

        // 範例表格
        const makeTable = (rows) => rows.map(([syntax, desc]) =>
          `<tr><td>${syntax}</td><td>${desc}</td></tr>`
        ).join('');

        let body = '';

        if (aliasChips) {
          body += `<div class="search-help-section">
            <h4><i class="fa-solid fa-tags text-indigo-500"></i> 可用的搜尋欄位 <span style="font-weight:400;font-size:11px;color:#9ca3af">（點擊可複製）</span></h4>
            <div style="padding:6px 8px;line-height:2.1">${aliasChips}</div>
          </div>`;
        }
        // 基本搜尋
        if (examples.basic && examples.basic.length) {
          body += `<div class="search-help-section">
            <h4><i class="fa-solid fa-font text-blue-500"></i> 基本搜尋</h4>
            <table class="search-help-table">${makeTable(examples.basic)}</table>
          </div>`;
        }
        // 進階篩選
        if (examples.advanced && examples.advanced.length) {
          body += `<div class="search-help-section">
            <h4><i class="fa-solid fa-filter text-green-500"></i> 進階篩選</h4>
            <table class="search-help-table">${makeTable(examples.advanced)}</table>
          </div>`;
        }
        // 組合範例
        if (examples.combo && examples.combo.length) {
          body += `<div class="search-help-section">
            <h4><i class="fa-solid fa-wand-magic-sparkles text-purple-500"></i> 組合範例</h4>
            <table class="search-help-table">${makeTable(examples.combo)}</table>
          </div>`;
        }
        document.getElementById('searchHelpBody').innerHTML = body;
        document.getElementById('searchHelpModal').classList.add('show');
      }
      // 建立各分頁的防抖搜尋函數
      const debouncedSearchP10 = SearchModule.createDebouncedSearch("p10", renderTransferPage);
      const debouncedSearchP5 = SearchModule.createDebouncedSearch("p5", renderNewBoardPage);
      const debouncedSearchP3 = SearchModule.createDebouncedSearch("p3", renderPCBKPITable);
      const debouncedSearchP9 = SearchModule.createDebouncedSearch("p9", renderPCBMaintainPage);
      const debouncedSearchP8 = SearchModule.createDebouncedSearch("p8", renderGPMSPage);
      const debouncedSearchP12 = SearchModule.createDebouncedSearch("p12", renderAssistPage);
      const debouncedSearchP14 = SearchModule.createDebouncedSearch("p14", renderDisablePage);
      const debouncedSearchP17 = SearchModule.createDebouncedSearch("p17", renderBOMPage);
      const debouncedSearchP19 = SearchModule.createDebouncedSearch("p19", renderDccPage);
      const debouncedSearchP20 = SearchModule.createDebouncedSearch("p20", renderEcrEcnPage);

      // ==========================================
      // 3. 全域狀態管理 (Global State)
      // ==========================================

      /* 主要資料容器 */
      let ecnData = [];
      let transferData = [];
      let boardData = { newBoard: [], maintain: [] };
      let pcbStore = { list: [], gpms: [], maintain: [] };
      let plmData = [];
      let assistData = [];
      let disableSubData = [];
      let bomData = [];
      let dccData = [];
      let ecrEcnData = [];

      /* 設定資料 */
      let settingsData = { maintainers: [], dropdowns: {} };
      let holidayDates = [];
      let holidaySet = new Set();
      let workdaySet = new Set();

      /* UI 狀態 */
      let isLoggedIn = false;
      let isSyncing = false;
      let lastSyncTime = null;
      const dirtySections = new Set();
      const deletedPages = new Set();
      const savingPages = new Set();

      /* 模組資料載入狀態 */
      let isBoardLoaded = false;
      let isPCBLoaded = false;
      let isOtherLoaded = false;

      /* 分頁狀態 */
      let paginationState = {
        p1: 1,
        p3: 1,
        p5: 1,
        p6: 1,
        p8: 1,
        p9: 1,
        p10: 1,
        p11: 1,
        p12: 1,
        p14: 1,
        p17: 1,
        p20: 1,
      };

      /* 排序與篩選狀態 */
      let sortConfig = { key: "id", asc: false };
      let boardSortConfig = {
        p5: { key: null, asc: false },
        p6: { key: null, asc: false },
      };
      let pcbSortConfig = { key: "id", asc: false };

      /* 模組同步狀態 */
      const moduleSyncState = {
        ECN: false,
        BOARD: false,
        PCB: false,
        OTHER: false,
        ECRECN: false,
      };
      /* 各模組最近一次顯示「同步完成」toast 的時間戳 (避免短時間切頁狂跳) */
      const lastToastTime = { ECN: 0, BOARD: 0, PCB: 0, OTHER: 0 };
      const TOAST_QUIET_PERIOD = 5 * 60 * 1000;   // 5 分鐘內切回同分頁靜音

      /* 圖表實例 */
      let cS = null,
        cD = null;

      /* 其他 */
      let currentTransferType = "ECN";

      /* 檔案名稱與頁面 ID 的對應 */
      const FILE_PAGE_MAP = {
        1: { type: "ecn", prefix: "ecn_" },
        3: { type: "pcb_list", prefix: "pcb_list_" },
        5: { type: "board_new", prefix: "board_new_" },
        6: { type: "board_maint", prefix: "board_maint_" },
        8: { type: "pcb_gpms", prefix: "pcb_gpms_" },
        9: { type: "pcb_maint", prefix: "pcb_maint_" },
        11: { type: "plm", prefix: "plm_" },
        12: { type: "assist", prefix: "assist_" },
        14: { type: "disable", prefix: "disable_" },
        17: { type: "bom", prefix: "bom_" },
        19: { type: "dcc", prefix: "dcc_" },
        20: { type: "ecrecn", prefix: "ecrecn_" },
      };

      // ==========================================
      // 4. 通用輔助函式 (Common Helpers)
      // ==========================================

      /* 輸入框內容修剪 */
      function trimInputsOnly(l) {
        const fixMap = { "\uFE45": "、" };
        if (Array.isArray(l))
          l.forEach((r) =>
            Object.keys(r).forEach((k) => {
              if (typeof r[k] === "string") {
                if (!k.match(/date|time/i)) r[k] = r[k].trim();
                for (const [bad, good] of Object.entries(fixMap)) {
                  if (r[k].includes(bad)) r[k] = r[k].replaceAll(bad, good);
                }
              }
            }),
          );
      }

      /* 防抖搜尋 */
      const debouncedSearchP1 = SearchModule.createDebouncedSearch("p1", renderTable);

      /* 人員相關 */
      function getActiveMaintainers() {
        return settingsData.maintainers.filter((m) => m.active).map((m) => m.name);
      }
      function isKPITarget(e) {
        if (!e) return !1;
        let n = getActiveMaintainers();
        return n.some((n) => e.includes(n));
      }
      const generateMaintainerOptions = (e) => {
        let o = getActiveMaintainers(),
          n = `<option value=""><\/option>` + o.map((o) => `<option value="${o}" ${e === o ? "selected" : ""}>${o}<\/option>`).join("");
        return (e && !o.includes(e) && (n += `<option value="${e}" selected>${e}<\/option>`), n);
      };

      /* 動態選單生成 */
      function generateDynamicOptions(e, t) {
        let o = settingsData.dropdowns && settingsData.dropdowns[e] ? settingsData.dropdowns[e] : [],
          i = `<option value="" disabled selected>請選擇</option>`;
        if (
          (t || (i = '<option value="" selected></option>'),
          o.forEach((e) => {
            if (e.active) {
              let o = t === e.value ? "selected" : "";
              i += `<option value="${e.value}" ${o}>${e.text}</option>`;
            }
          }),
          t)
        ) {
          let l = o.some((e) => e.active && e.value === t);
          if (!l) {
            let n = o.find((e) => e.value === t),
              a = n ? n.text : t;
            i += `<option value="${t}" selected class="text-gray-500 bg-gray-200">[舊/停用] ${a}</option>`;
          }
        }
        return i;
      }

      /* 日期變更同步處理 */
      function handleDateChangeWithYearSync(e, l, n, a = null) {
        let t = DateUtils.normalizeYear(e),
          u = document.getElementById(l),
          o = u ? u.value : null;
        if (u && t && o !== t && o !== "ALL") {
          if (![...u.options].some((e) => e.value === t)) {
            let p = document.createElement("option");
            ((p.value = t), (p.text = t + " 年"));
            let d = !1;
            for (let i = 0; i < u.options.length; i++)
              if (u.options[i].value !== "ALL" && u.options[i].value < t) {
                (u.add(p, i), (d = !0));
                break;
              }
            d || u.add(p);
          }
          ((u.value = t), n(a), ToastModule.show(`已切換至 ${t} 年`, "info"));
        } else n();
      }

      /* 取得檔案更新時間的格式化字串 */
      function getFileLastUpdatedStr(t) {
        let e = FILE_PAGE_MAP[t];
        if (!e) return "";
        let i = e.prefix,
          r = Object.keys(YearlyModule.fileTimestamps).filter((t) => t.startsWith(i)),
          l = null;
        return (r.forEach((t) => {
          let e = YearlyModule.fileTimestamps[t];
          e && (!l || e > l) && (l = e);
        }),
        l)
          ? l
              .toLocaleString("zh-TW", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: !1,
              })
              .replace(/\//g, "-")
          : "尚未同步";
      }

      /* 渲染檔案更新時間標籤 */
      function renderFileTimeLabel(e, t) {
        let l = document.getElementById(e);
        if (!l) return;
        let s = getFileLastUpdatedStr(t),
          a = FILE_PAGE_MAP[t],
          i = null;
        if (a) {
          let n = a.prefix;
          Object.keys(YearlyModule.fileTimestamps).forEach((e) => {
            if (e.startsWith(n)) {
              let t = YearlyModule.fileTimestamps[e];
              t && (!i || t > i) && (i = t);
            }
          });
        }
        let r = i && new Date() - i > 1728e5,
          f = "text-gray-400";
        (i && (f = r ? "text-amber-500 font-bold" : "text-emerald-500 font-bold"), (l.innerHTML = `<span class="text-xs ${f} flex items-center gap-2 select-none" title="資料更新時間"><i class="fa-solid fa-cloud-arrow-up"></i><span>${s}</span></span>`));
      }

      // ==========================================
      // 4.1 逾期計算模組 (Overdue Module)
      // ==========================================

      const OverdueModule = {
        thresholdsPage1: {
          "2.急件": { 一般: 4, 複雜: 6 },
          "1.一般": { 一般: 6, 複雜: 8 },
        },
        thresholdsPage17: {
          "3.特急": 4,
          "2.急件": 5,
          "1.一般": 8,
        },
        thresholdsPage5: {
          "急件": 2,
          "一般": 3,
        },

        /* P1 逾期：依 priority/complexity 比對 totalDays */
        isOverduePage1(priority, complexity, totalDays) {
          if (typeof totalDays !== "number" || !complexity) return false;
          const threshold = this.thresholdsPage1[priority]?.[complexity];
          return threshold ? totalDays > threshold : false;
        },
        getThresholdPage1(priority, complexity) {
          if (!complexity) return null;
          return this.thresholdsPage1[priority]?.[complexity] || null;
        },

        /* P17 逾期：依 priority (一般/急件/特急) 比對 workDays */
        isOverduePage17(priority, workDays) {
          if (typeof workDays !== "number" || !priority) return false;
          const threshold = this.thresholdsPage17[priority];
          return threshold ? workDays > threshold : false;
        },
        getThresholdPage17(priority) {
          return this.thresholdsPage17[priority] || null;
        },

        /* P5 逾期：依 priority (急件/一般) 比對 workDays */
        isOverduePage5(priority, workDays) {
          if (typeof workDays !== "number" || !priority) return false;
          const threshold = this.thresholdsPage5[priority];
          return threshold ? workDays > threshold : false;
        },
        getThresholdPage5(priority) {
          return this.thresholdsPage5[priority] || null;
        },

        /* P3 PCB 逾期：固定 3 天閾值 */
        thresholdsPage3: 3,
        getOverdueDaysPage3(kpi, isRejected) {
          if (isRejected) return null;
          if (typeof kpi !== "number" || kpi <= this.thresholdsPage3) return null;
          return kpi - this.thresholdsPage3;
        },
        isOverduePage3(kpi, isRejected) {
          return this.getOverdueDaysPage3(kpi, isRejected) !== null;
        },
        getThresholdPage3() {
          return this.thresholdsPage3;
        },
      };

      const CancelInputModule = {
        /* 綁定 rawInput 監聽 + FlatpickrManager 初始化 */
        setup(selector, updateFn) {
          document.querySelectorAll(selector).forEach((input) => {
            input.addEventListener("input", function () {
              this._rawInput = this.value.trim();
            });
          });
          FlatpickrManager.init(selector, (e, t) => {
            const raw = e._rawInput || "";
            if (raw === "取消") {
              e.value = "取消";
              updateFn(e, "取消");
            } else {
              updateFn(e, t);
            }
            // 注意：不能重置 e._rawInput = ""，否則同一次交互中 wrapper 若被觸發兩次
            //（全域 change + flatpickr onClose），第二次的 raw 會變空 → 走 else 分支 → 覆蓋掉 "取消"
          });
        },
        /* 取消狀態的CSS class */
        cancelClass(value) {
          return value === "取消" ? " !text-red-500 font-bold" : "";
        },
        /* 回傳取消狀態的顯示值 */
        displayValue(value) {
          return value === "取消" ? "取消" : DateUtils.formatDisplay(value);
        },
      };

      /* 根據料號末3碼判斷階段 */
      function getStageFromPartNo(partNo) {
        if (!partNo) return "";
        const last3 = partNo.slice(-3).toUpperCase();
        if (last3.includes("S")) return "打樣";
        return "量產";
      }

      // ==========================================
      // 5. 通用 UI 組件 (Shared UI Components)
      // ==========================================

      /* 分頁控制渲染 */
      const FILTER_EXPORT_PAGES = ["p1","p3","p5","p8","p9","p10","p12","p14","p17","p19","p20"];
      function renderPaginationControls(o, a, e, r) {
        let s = Math.ceil(e / PAGE_SIZE) || 1;
        (paginationState[a] > s && (paginationState[a] = s), paginationState[a] < 1 && (paginationState[a] = 1));
        let t = document.getElementById(o);
        if (!t) return;
        // 匯出篩選按鈕：搜尋空字串時反灰
        let exportBtnHtml = "";
        if (FILTER_EXPORT_PAGES.includes(a)) {
          const kw = (document.getElementById(`searchBox_${a}`)?.value || "").trim();
          exportBtnHtml = `<button onclick="exportFilteredByPage('${a}')" class="absolute right-3 flex items-center gap-1 p-2 text-xs btn-success disabled:opacity-40 disabled:cursor-not-allowed" ${kw ? "" : "disabled"} title="${kw ? "匯出當前搜尋結果" : "請先輸入搜尋關鍵字"}"><i class="fa-solid fa-file-excel"></i><span>匯出篩選</span></button>`;
          if (getComputedStyle(t).position === "static") t.style.position = "relative";
        }
        t.innerHTML = `<button onclick="changePageModular('${a}', -1, '${r}')" class="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-100 transition-colors shadow-sm disabled:opacity-30 disabled:cursor-not-allowed" ${1 === paginationState[a] ? "disabled" : ""}><i class="fa-solid fa-chevron-left mr-1"></i> 上一頁</button><span class="mx-2 font-bold text-xs text-gray-700">第 ${paginationState[a]} 頁 / 共 ${s} 頁</span>
                      <button onclick="changePageModular('${a}', 1, '${r}')" class="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-100 transition-colors shadow-sm disabled:opacity-30 disabled:cursor-not-allowed" ${paginationState[a] === s ? "disabled" : ""}>下一頁<i class="fa-solid fa-chevron-right ml-1"></i></button>${exportBtnHtml}`;
      }

      function getPaginatedData(t, e) {
        let a = (paginationState[e] - 1) * PAGE_SIZE;
        return t.slice(a, a + PAGE_SIZE);
      }

      /* 分頁切換 */
      function changePageModular(a, n, c) {
        ((paginationState[a] += n), window[c]());
      }

      /* 側邊欄表格渲染 */
      function renderSidebarTable(t, e, r, l, n = "p-3", o = !1) {
        let a = document.getElementById(t);
        a &&
          (a.innerHTML = e.length
            ? e
                .map(
                  (t) => `<tr class="transition-colors hover:bg-gray-50">
              <td class="${n} border-b text-left pl-6 font-bold text-gray-600">${DateUtils.formatMonthDisplay(t, o)}</td>
              ${l.map((e) => `<td class="${n} border-b font-bold ${e.colorClass || "text-gray-700"}">${r(t)[e.key] || 0}${e.suffix || ""}</td>`).join("")}</tr>`,
                )
                .join("")
            : `<tr><td colspan="${l.length + 1}" class="p-4 text-center text-gray-400">尚無數據</td></tr>`);
      }

      /* 通用側邊欄渲染 */
      function renderGenericSidebar(e, r, t, s, i = " 筆", l = !0) {
        let n = e || [],
          o = [...new Set(n.map((e) => DateUtils.normalizeYear(e[r])).filter((e) => e))].sort().reverse(),
          c = Utils.initYearSelect(t, o, "年", l),
          f = "ALL" === c,
          a = {};
        (n
          .filter((e) => f || !e[r] || DateUtils.normalizeYear(e[r]) === c)
          .forEach((e) => {
            let t = DateUtils.normalizeMonth(e[r]);
            t && (a[t] = (a[t] || 0) + 1);
          }),
          renderSidebarTable(s, Object.keys(a).sort().reverse(), (e) => ({ count: a[e] }), [{ key: "count", colorClass: "text-ms-blue", suffix: i }], "p-3", f));
      }

      /* 取年度下拉值，ALL 回 null */
      function getSelectedYear(e) {
        let t = document.getElementById(e),
          l = t?.value;
        return "ALL" === l ? null : l;
      }

      /* KPI 卡片渲染 */
      function renderKPICards(cid, items) {
        document.getElementById(cid).innerHTML = items.map((k) => `<div class="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg shadow-sm"><div><div class="mb-1 font-bold text-[11px] text-gray-400 uppercase">${k.label}<\/div><div class="text-2xl font-black ${k.text || "text-gray-700"}">${k.val}<span class="font-normal text-xs text-gray-400">${k.unit || ""}<\/span><\/div><\/div><div class="w-2 h-8 rounded-full ${k.color}"><\/div><\/div>`).join("");
      }

      /* Badge 樣式 */
      function getBadgeClass(s) {
        const b = "px-2 py-0.5 rounded-full text-[10px] font-bold inline-block";
        if (!s) return `${b} bg-red-100 text-red-800`;
        if (s.includes("駁回") || s.includes("撤回")) return `${b} bg-red-100 text-red-800`;
        if (s.includes("同意") || s.includes("結束")) return `${b} bg-green-100 text-green-800`;
        if (s === "進行中") return `${b} bg-yellow-100 text-yellow-800`;
        return `${b} bg-red-100 text-red-800`;
      }

      /* 通用刪除 */
      function deleteGeneralRow(r, e) {
        if (!confirm("確定刪除此項目？")) return;
        let a = {
            newBoard: {
              arr: boardData.newBoard,
              type: "board_new",
              render: renderNewBoardPage,
              page: 5,
            },
            boardMaintain: {
              arr: boardData.maintain,
              type: "board_maint",
              render: renderMaintainPage,
              page: 6,
            },
            gpms: {
              arr: pcbStore.gpms,
              type: "pcb_gpms",
              render: renderGPMSPage,
              page: 8,
            },
            pcbMaintain: {
              arr: pcbStore.maintain,
              type: "pcb_maint",
              render: renderPCBMaintainPage,
              page: 9,
            },
            plm: { arr: plmData, type: "plm", render: renderPLMPage, page: 11 },
            assist: {
              arr: assistData,
              type: "assist",
              render: renderAssistPage,
              page: 12,
            },
            bom: { arr: bomData, type: "bom", render: renderBOMPage, page: 17 },
            disable: {
              arr: disableSubData,
              type: "disable",
              render: renderDisablePage,
              page: 14,
            },
            dcc: { arr: dccData, type: "dcc", render: renderDccPage, page: 19 },
          },
          p = a[r];
        if (!p) return;
        let n = p.arr[e];
        let wasBlank = Utils.isRowBlank(n);
        let wasNewRow = n && n._isNew === true;
        
        p.arr.splice(e, 1);
        p.render();
        
        if (!wasBlank && !wasNewRow) {
          n && YearlyModule.markDirtyFromRecord(p.type, n);
          deletedPages.add(p.page);
        }
        updateSaveButtonStatus();
      }

      /* 通用新增資料行 */
      function addGenericRow(e) {
        let { dataArray: o, defaultRow: r, paginationKey: t, renderFn: a, triggerPageId: l, scrollSelector: n, dataType: d } = e,
          i = { ...r, _dirty: true, _isNew: true };
        (o.unshift(i),
          (paginationState[t] = 1),
          a(),
          updateSaveButtonStatus(),
          setTimeout(() => {
            document.querySelector(n)?.scrollTo({ top: 0, behavior: "smooth" });
          }, 0));
      }

      /* 篩選匯出：取當前搜尋過濾後的資料匯出 (空字串時按鈕反灰，不會走到這) */
      let _filteredExportData = null;
      function exportFilteredByPage(pageKey) {
        const map = {
          p1:  { data: () => ecnData,            fn: exportDetailList },
          p3:  { data: () => pcbStore.list,      fn: exportPCBExcel },
          p5:  { data: () => boardData.newBoard, fn: exportNewBoardExcel },
          p8:  { data: () => pcbStore.gpms,      fn: exportGPMSExcel },
          p9:  { data: () => pcbStore.maintain,  fn: exportPCBMaintainExcel },
          p10: { data: () => transferData,       fn: exportTransferExcel },
          p12: { data: () => assistData,         fn: exportAssistExcel },
          p14: { data: () => disableSubData,     fn: exportDisableExcel },
          p17: { data: () => bomData,            fn: exportBOMExcel },
          p19: { data: () => dccData,            fn: exportDccExcel },
          p20: { data: () => ecrEcnData,         fn: exportEcrEcnExcel },
        };
        const c = map[pageKey];
        if (!c) return;
        const kw = (document.getElementById(`searchBox_${pageKey}`)?.value || "").trim();
        if (!kw) return;
        const indexed = c.data().map((e, i) => ({ ...e, _origIdx: i }));
        _filteredExportData = SearchModule.filterData(indexed, pageKey, kw);
        try { c.fn(); } finally { _filteredExportData = null; }
      }

      /* 通用Excel匯出 (1 秒內重複呼叫直接擋掉，避免多次下載) */
      let _lastExportTime = 0;
      function exportGenericExcel(e) {
        const now = Date.now();
        if (now - _lastExportTime < 1000) return;
        _lastExportTime = now;
        let { data: t, columnMapping: l, fileName: i, sheetName: n, transform: r, yearSelectId: o, dateField: a } = e,
          s = t;
        if (o && a) {
          let f = getSelectedYear(o);
          if (f) {
            const getDate = typeof a === "function" ? a : (row) => row[a];
            s = t.filter((e) => {
              const d = getDate(e);
              if (!d) return true;
              return (/^\d{4}$/.test(d) ? d : DateUtils.normalizeYear(d)) === f;
            });
          }
        }
        if (!s || !s.length) return ToastModule.show("無資料", "warning");
        let u = s.map((e) => {
            let t = r ? r(e) : e,
              i = {};
            for (let [n, o] of Object.entries(l)) {
              let v = t[n] || "";
              if (v instanceof Date) {
                v = (Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()) - Date.UTC(1899, 11, 30)) / 86400000;
              }
              i[o] = v;
            }
            return i;
          }),
          p = XLSX.utils.book_new(),
          ws = XLSX.utils.json_to_sheet(u);
        for (let c in ws) {
          if (c[0] === "!" || !ws[c]) continue;
          if (typeof ws[c].v === "number" && ws[c].v > 40000 && ws[c].v < 60000) {
            ws[c].t = "n";
            ws[c].z = "yyyy/mm/dd";
          }
        }
        XLSX.utils.book_append_sheet(p, ws, n);
        if (e.extraSheets) {
          for (const ex of e.extraSheets) {
            const exWs = ex.aoa ? XLSX.utils.aoa_to_sheet(ex.aoa) : XLSX.utils.json_to_sheet(ex.data);
            XLSX.utils.book_append_sheet(p, exWs, ex.name);
          }
        }
        XLSX.writeFile(p, i);ToastModule.show(`${n} 匯出成功`, "success");
      }

      /* 通用更新資料行 (含日期年份同步；新舊值相同則跳過避免誤標 dirty) */
      function updateGenericRow(e) {
        let { dataArray: a, index: d, field: t, value: r, yearSelectId: i, dateField: n, renderFn: l, triggerPageId: f, dataType: p, beforeUpdate: c, afterUpdate: g } = e,
          o = a[d];
        if (!o) return;
        if ((o[t] || "") === (r || "")) return;
        if (t === n && p) {
            let oldYear = YearlyModule.getYear(o, n) || String(new Date().getFullYear());
            YearlyModule.markDirty(p, oldYear);
        }
        c && c(o, t, r);
        o[t] = r;
        g && g(o, t, r);
        triggerChange(f, o, p);
        t === n ? handleDateChangeWithYearSync(r, i, (e) => l(e), d) : l();
      }

      // ==========================================
      // 5.1 批次貼上通用模組 (Batch Paste Module)
      // ==========================================
      const BatchPasteModule = (() => {
        let _parsedRows = [];
        let _activeConfig = null;
        const MODAL_ID = "batchPasteModal";

        /* 將貼上文字解析為資料列 (Tab/CSV 自動偵測) */
        function parseText(raw, columns) {
          return raw
            .split(/\r?\n/)
            .filter(line => line.trim().length > 0)
            .map(line => {
              const cols = line.includes("\t") ? line.split("\t") : line.split(",");
              const get = (i) => (cols[i] || "").trim();
              const row = {};
              columns.forEach(def => {
                let val = get(def.col);
                if (def.type === "date") val = DateUtils.normalizeDateStr(val);
                row[def.key] = val;
              });
              return row;
            });
        }

        /* 驗證 */
        function validateRows(rows, columns) {
          let errorCount = 0;
          const results = rows.map(row => {
            const errors = {};
            columns.forEach(def => {
              if (def.type === "date" && row[def.key] && !DateUtils.isValidDate(row[def.key])) {
                errors[def.key] = "date";
                errorCount++;
              }
              if (def.required && !row[def.key]) {
                errors[def.key] = "required";
                errorCount++;
              }
            });
            return { row, errors };
          });
          return { results, errorCount };
        }

        /* UI：Modal 建構 */
        function _buildModalHtml(config) {
          const esc = Utils.escapeHtml || ((v) => v || "");

          // 額外全域欄位（如「套用執行人」下拉）
          let extraFieldsHtml = "";
          if (config.extraFields && config.extraFields.length) {
            extraFieldsHtml = config.extraFields.map(f => {
              if (f.type === "select") {
                return `<div class="w-[160px] shrink-0">
                  <p class="text-xs font-semibold text-gray-600 mb-1.5">${f.icon || '<i class="fa-solid fa-user text-ms-blue mr-1"></i>'}${esc(f.label)}</p>
                  <select id="bp_extra_${f.key}" class="w-full px-2 py-1.5 text-xs text-gray-700 border border-gray-300 rounded-lg outline-none shadow-sm focus:ring-2 focus:ring-ms-blue">
                    <option value=""></option>
                  </select>
                </div>`;
              }
              return "";
            }).join("");
          }

          // 預覽表頭
          const previewCols = config.columns.filter(c => c.label);
          const allPreviewHeaders = [
            ...previewCols.map(c => `<th class="px-2 py-1.5 border-b text-gray-600 font-semibold">${esc(c.label)}</th>`),
            ...(config.extraFields || []).map(f => `<th class="px-2 py-1.5 border-b text-gray-600 font-semibold">${esc(f.label)}</th>`),
          ].join("");

          return `<div class="fixed inset-0 z-[10003] flex hidden items-center justify-center bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="${MODAL_ID}">
            <div class="w-[720px] max-h-[90vh] flex flex-col bg-white rounded-xl shadow-2xl">
              <div class="flex gap-4 px-6 pt-5 pb-3">
                ${extraFieldsHtml}
                <div class="flex-1">
                  <textarea id="bp_pasteArea"
                    class="w-full h-[110px] p-3 text-xs font-mono border-2 border-dashed border-amber-300 rounded-lg outline-none resize-none focus:border-amber-500 bg-amber-50 placeholder-gray-400"
                    placeholder="${esc(config.placeholder || "在此貼上從 Excel 複製的資料（Ctrl+V）")}"></textarea>
                </div>
              </div>
              <div class="flex-1 overflow-hidden px-6 pb-3">
                <div id="bp_preview" class="h-full flex-col" style="display:none">
                  <div class="flex items-center justify-between mb-1.5">
                    <span class="text-xs font-semibold text-gray-600">預覽（共 <span id="bp_count" class="text-ms-blue font-bold">0</span> 筆）</span>
                  </div>
                  <div class="flex-1 overflow-y-auto rounded-lg border border-gray-200">
                    <table class="w-full text-xs text-left border-separate border-spacing-0">
                      <thead class="sticky top-0 bg-gray-50"><tr>${allPreviewHeaders}</tr></thead>
                      <tbody id="bp_previewBody" class="divide-y divide-gray-100"></tbody>
                    </table>
                  </div>
                </div>
                <div id="bp_empty" class="flex items-center justify-center h-16 text-xs text-gray-300">貼上資料後將顯示預覽</div>
              </div>
              <div class="flex items-center justify-between px-6 py-4 border-t border-gray-200 rounded-b-xl">
                <button id="bp_cancelBtn" class="px-4 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors">取消</button>
                <button id="bp_confirmBtn" disabled
                  class="px-5 py-2 text-sm font-bold text-white bg-amber-500 rounded-lg shadow-sm hover:bg-amber-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  <i class="fa-solid fa-check mr-1"></i>新增 <span id="bp_confirmCount"></span>
                </button>
              </div>
            </div>
          </div>`;
        }

        function _ensureModal(config) {
          let el = document.getElementById(MODAL_ID);
          if (el) el.remove();
          document.body.insertAdjacentHTML("beforeend", _buildModalHtml(config));
          el = document.getElementById(MODAL_ID);
          el.querySelector("#bp_pasteArea").addEventListener("input", () => _onPreview(config));
          el.querySelector("#bp_cancelBtn").addEventListener("click", close);
          el.querySelector("#bp_confirmBtn").addEventListener("click", () => _onConfirm(config));
          (config.extraFields || []).forEach(f => {
            const sel = el.querySelector(`#bp_extra_${f.key}`);
            if (sel && f.type === "select") {
              sel.addEventListener("change", () => _onPreview(config));
            }
          });
          return el;
        }

        /* UI：開啟 / 關閉 */
        function open(config) {
          _activeConfig = config;
          _parsedRows = [];
          const el = _ensureModal(config);
          // 填充額外欄位的選項
          (config.extraFields || []).forEach(f => {
            if (f.type === "select") {
              const sel = el.querySelector(`#bp_extra_${f.key}`);
              if (!sel) return;
              const prevVal = sel.value;
              sel.innerHTML = '<option value=""></option>';
              const opts = typeof f.options === "function" ? f.options() : (f.options || []);
              opts.forEach(name => {
                const opt = document.createElement("option");
                opt.value = name;
                opt.textContent = name;
                sel.appendChild(opt);
              });
              sel.value = prevVal || "";
            }
          });

          el.classList.remove("hidden");
          setTimeout(() => el.querySelector("#bp_pasteArea")?.focus(), 50);
        }
        function close() {
          const el = document.getElementById(MODAL_ID);
          if (el) el.classList.add("hidden");
          _parsedRows = [];
          _activeConfig = null;
        }

        /* UI：預覽渲染 */
        function _onPreview(config) {
          const raw = document.getElementById("bp_pasteArea").value;
          const preview = document.getElementById("bp_preview");
          const tbody = document.getElementById("bp_previewBody");
          const countEl = document.getElementById("bp_count");
          const confirmBtn = document.getElementById("bp_confirmBtn");
          const confirmCount = document.getElementById("bp_confirmCount");
          if (!raw.trim()) {
            preview.style.display = "none";
            document.getElementById("bp_empty")?.style.setProperty("display", "flex");
            confirmBtn.disabled = true;
            _parsedRows = [];
            return;
          }
          let rows = parseText(raw, config.columns);
          const extraValues = {};
          (config.extraFields || []).forEach(f => {
            const el = document.getElementById(`bp_extra_${f.key}`);
            if (el) extraValues[f.key] = el.value;
          });
          rows = rows.map(r => ({ ...r, ...extraValues }));
          if (typeof config.afterParse === "function") {
            rows.forEach(r => config.afterParse(r));
          }
          _parsedRows = rows;
          const { results, errorCount } = validateRows(rows, config.columns);
          let badDateCount = 0;
          results.forEach(({ errors }) => {
            if (Object.values(errors).includes("date")) badDateCount++;
          });
          const esc = (v) => Utils.escapeHtml ? Utils.escapeHtml(v) : (v || "");
          const previewCols = config.columns.filter(c => c.label);
          const extraFieldDefs = config.extraFields || [];
          tbody.innerHTML = results.map(({ row, errors }) => {
            const hasErr = Object.keys(errors).length > 0;
            const rowClass = hasErr ? "bg-red-50" : "";
            const dataCells = previewCols.map(def => {
              const val = row[def.key] || "";
              const err = errors[def.key];
              if (err === "date") {
                return `<td class="px-2 py-1 text-red-500 font-semibold">${val} <i class="fa-solid fa-circle-xmark"></i></td>`;
              }
              if (err === "required") {
                return `<td class="px-2 py-1 text-red-500 font-semibold"><i class="fa-solid fa-circle-xmark"></i> 空白</td>`;
              }
              return `<td class="px-2 py-1 text-gray-700">${esc(val)}</td>`;
            }).join("");
            const extraCells = extraFieldDefs.map(f => {
              const val = row[f.key] || "";
              return `<td class="px-2 py-1 ${val ? "text-gray-700" : "text-gray-300"}">${esc(val) || "—"}</td>`;
            }).join("");
            return `<tr class="${rowClass}">${dataCells}${extraCells}</tr>`;
          }).join("");

          const count = rows.length;
          countEl.textContent = count;
          document.getElementById("bp_empty")?.style.setProperty("display", "none");
          preview.style.display = "flex";
          preview.style.flexDirection = "column";
          confirmBtn.disabled = count === 0 || errorCount > 0;
          confirmCount.textContent = errorCount > 0
            ? `— 有 ${badDateCount > 0 ? badDateCount + " 筆日期格式不符（支援 yyyy/mm/dd）" : errorCount + " 筆資料有誤"}`
            : `(${count} 筆)`;
        }

        /* 確認送出 */
        function _onConfirm(config) {
          if (!_parsedRows.length) return;
          if (typeof config.onConfirm === "function") {
            config.onConfirm([..._parsedRows]);
          }
          close();
        }
        return { open, close, parseText, validateRows };
      })();

      // ==========================================
      // 6. 資料存取層 (Data Access Layer)
      // ==========================================

      /* 快取讀取 */
      function loadFromCache() {
        try {
          const hc = localStorage.getItem("ecn_holiday_cache");
          const wc = localStorage.getItem("ecn_workday_cache");
          if (hc) { holidayDates = JSON.parse(hc); holidaySet = new Set(holidayDates); }
          if (wc) workdaySet = new Set(JSON.parse(wc));
        } catch {}
        try {
          let a = localStorage.getItem("ec_all_cache");
          if (!a) return !1;
          let t = JSON.parse(a),
            e = t.timestamp || 0,
            s = Date.now() - e;
          return (
            (ecnData = t.ecnData || []),
            (transferData = t.transferData || []),
            (boardData = t.boardData || { newBoard: [], maintain: [] }),
            (pcbStore = t.pcbStore || { list: [], gpms: [], maintain: [] }),
            (plmData = t.plmData || []),
            (assistData = t.assistData || []),
            (disableSubData = t.disableSubData || []),
            (bomData = t.bomData || []),
            (dccData = t.dccData || []),
            (ecrEcnData = t.ecrEcnData || []),
            t.settingsData && (settingsData = t.settingsData),
            t.yearlyTimestamps &&
              Object.entries(t.yearlyTimestamps).forEach(([a, t]) => {
                YearlyModule.fileTimestamps[a] = t ? new Date(t) : null;
              }),
            (isBoardLoaded = !0),
            (isPCBLoaded = !0),
            (isOtherLoaded = !0),
            (lastSyncTime = new Date(e)),
            ecrEcnData.length && (preprocessEcrEcnData(), initEcrEcnYearSelect()),
            s > CACHE_MAX_AGE ? updateSyncStatus("stale", `${formatTime(lastSyncTime)}`) : updateSyncStatus("success", formatTime(lastSyncTime)),
            console.log("[Cache] 已從快取載入"),
            !0
          );
        } catch (n) {
          return (console.warn("快取讀取失敗", n), !1);
        }
      }

      /* 快取儲存 */
      function saveToCache() {
        try {
          const clean = (arr) => (arr || []).map(r => {
            if (!r || !r._dirty) return r;
            const copy = { ...r };
            delete copy._dirty;
            delete copy._isNew;
            return copy;
          });
          let a = {
            timestamp: Date.now(),
            ecnData: clean(ecnData),
            transferData: clean(transferData),
            boardData: { newBoard: clean(boardData.newBoard), maintain: clean(boardData.maintain) },
            pcbStore: { list: clean(pcbStore.list), gpms: clean(pcbStore.gpms), maintain: clean(pcbStore.maintain) },
            plmData: clean(plmData),
            assistData: clean(assistData),
            disableSubData: clean(disableSubData),
            bomData: clean(bomData),
            dccData: clean(dccData),
            ecrEcnData: clean(ecrEcnData),
            settingsData,
            yearlyTimestamps: YearlyModule.fileTimestamps,
          };
          localStorage.setItem("ec_all_cache", JSON.stringify(a));
        } catch (e) {
          console.warn("快取儲存失敗", e);
        }
      }

      /* 並行載入所有資料 */
      async function loadAllDataParallel(showMsg = false) {
        if (isSyncing) {
          ToastModule.show("正在同步中，請稍候...", "warning");
          return;
        }
        isSyncing = true;
        updateSyncStatus("syncing", "同步中...");
        if (showMsg) ToastModule.show("正在載入資料...", "info");

        try {
          const [ecnRes, boardRes, pcbRes, otherRes] = await Promise.all([fetch(`${GITHUB_API_BASE}/gists/${GIST_CONFIG.ECN.ID}?t=${new Date().getTime()}`, { headers: { Authorization: `token ${GITHUB_TOKEN}` } }), fetch(`${GITHUB_API_BASE}/gists/${GIST_CONFIG.BOARD.ID}?t=${new Date().getTime()}`, { headers: { Authorization: `token ${GITHUB_TOKEN}` } }), fetch(`${GITHUB_API_BASE}/gists/${GIST_CONFIG.PCB.ID}?t=${new Date().getTime()}`, { headers: { Authorization: `token ${GITHUB_TOKEN}` } }), fetch(`${GITHUB_API_BASE}/gists/${GIST_CONFIG.OTHER.ID}?t=${new Date().getTime()}`, { headers: { Authorization: `token ${GITHUB_TOKEN}` } })]);

          if (!ecnRes.ok || !boardRes.ok || !pcbRes.ok || !otherRes.ok) throw Error("API 回應錯誤");

          const [ecnGist, boardGist, pcbGist, otherGist] = await Promise.all([ecnRes.json(), boardRes.json(), pcbRes.json(), otherRes.json()]);

          // 處理可能被截斷的大型檔案 (超過 1MB 時 Gist API 會截斷)
          const [ecnFiles, boardFiles, pcbFiles, otherFiles] = await Promise.all([handleTruncatedFiles(ecnGist.files), handleTruncatedFiles(boardGist.files), handleTruncatedFiles(pcbGist.files), handleTruncatedFiles(otherGist.files)]);

          // ECN Gist - 分年份載入
          const { PREFIX: ecnPrefix, FILES: ecnFileKeys } = GIST_CONFIG.ECN;
          OverlayModule.loadEcnFromArray(YearlyModule.loadAndMerge(ecnFiles, ecnPrefix.ECN, null));
          ecnData = [];
          transferData = [];

          // 載入設定
          if (ecnFiles[ecnFileKeys.SETTINGS]) {
            settingsData = JSON.parse(ecnFiles[ecnFileKeys.SETTINGS].content);
            localStorage.setItem("ec_settings", JSON.stringify(settingsData));
          }
          // 載入假日
          if (ecnFiles[ecnFileKeys.HOLIDAYS]) {
            const hData = JSON.parse(ecnFiles[ecnFileKeys.HOLIDAYS].content);
            if (hData.holidays) {
              holidayDates = hData.holidays;
              holidaySet = new Set(holidayDates);
            }
            if (hData.workdays) workdaySet = new Set(hData.workdays);
          }

          // BOARD Gist - 分年份載入
          const { PREFIX: boardPrefix } = GIST_CONFIG.BOARD;
          boardData = {
            newBoard: YearlyModule.loadAndMerge(boardFiles, boardPrefix.NEW, "createDate"),
            maintain: YearlyModule.loadAndMerge(boardFiles, boardPrefix.MAINTAIN, "date"),
          };
          isBoardLoaded = true;

          // PCB Gist - 分年份載入
          const { PREFIX: pcbPrefix } = GIST_CONFIG.PCB;
          pcbStore = {
            list: YearlyModule.loadAndMerge(pcbFiles, pcbPrefix.LIST, "time3"),
            gpms: YearlyModule.loadAndMerge(pcbFiles, pcbPrefix.GPMS, "date"),
            maintain: YearlyModule.loadAndMerge(pcbFiles, pcbPrefix.MAINTAIN, "date"),
          };
          isPCBLoaded = true;

          // OTHER Gist - 分年份載入
          const { PREFIX: otherPrefix } = GIST_CONFIG.OTHER;
          plmData = YearlyModule.loadAndMerge(otherFiles, otherPrefix.PLM, "date");
          assistData = YearlyModule.loadAndMerge(otherFiles, otherPrefix.ASSIST, "date");
          disableSubData = YearlyModule.loadAndMerge(otherFiles, otherPrefix.DISABLE, "date");
          bomData = YearlyModule.loadAndMerge(otherFiles, otherPrefix.BOM, "completeDate");
          dccData = YearlyModule.loadAndMerge(otherFiles, otherPrefix.DCC, "date");
          isOtherLoaded = true;

          lastSyncTime = new Date();
          saveToCache();
          updateMonthSelect();
          updateDatalists();
          refreshCurrentPage();
          updateSyncStatus("success", formatTime(lastSyncTime));
          ToastModule.show("同步完成", "success");
        } catch (err) {
          console.error("同步失敗:", err);
          lastSyncTime ? updateSyncStatus("stale", `${formatTime(lastSyncTime)} (離線)`) : updateSyncStatus("stale", "載入失敗");
          ToastModule.show("同步失敗，使用快取資料", "warning");
        } finally {
          isSyncing = false;
        }
      }

      /* 載入單一 Gist */
      async function loadSingleGist(e) {
        if (isSyncing) {
          ToastModule.show("正在同步中，請稍候...", "warning");
          return;
        }
        isSyncing = true;
        updateSyncStatus("syncing", "同步中...");
        const gistNames = {
          ECN: "ECN",
          BOARD: "板階",
          PCB: "PCB",
          OTHER: "其他統計",
          ECRECN: "ECR/ECN 追蹤",
        };

        try {
          const { ID: gistId, PREFIX: prefix, FILES: fileKeys } = GIST_CONFIG[e];
          const res = await fetch(`${GITHUB_API_BASE}/gists/${gistId}?t=${new Date().getTime()}`, { headers: { Authorization: `token ${GITHUB_TOKEN}` } });
          if (!res.ok) throw Error("API 回應錯誤");
          const gistData = await res.json();
          const files = await handleTruncatedFiles(gistData.files);

          switch (e) {
            case "ECN":
              OverlayModule.loadEcnFromArray(YearlyModule.loadAndMerge(files, prefix.ECN, null));
              ecnData = [];
              transferData = [];
              if (files[fileKeys.SETTINGS]) {
                settingsData = JSON.parse(files[fileKeys.SETTINGS].content);
                localStorage.setItem("ec_settings", JSON.stringify(settingsData));
              }
              if (files[fileKeys.HOLIDAYS]) {
                const hData = JSON.parse(files[fileKeys.HOLIDAYS].content);
                if (hData.holidays) {
                  holidayDates = hData.holidays;
                  holidaySet = new Set(holidayDates);
                }
                if (hData.workdays) workdaySet = new Set(hData.workdays);
              }
              updateMonthSelect();
              break;
            case "BOARD":
              boardData = {
                newBoard: YearlyModule.loadAndMerge(files, prefix.NEW, "createDate"),
                maintain: YearlyModule.loadAndMerge(files, prefix.MAINTAIN, "date"),
              };
              break;
            case "PCB":
              pcbStore = {
                list: YearlyModule.loadAndMerge(files, prefix.LIST, "time3"),
                gpms: YearlyModule.loadAndMerge(files, prefix.GPMS, "date"),
                maintain: YearlyModule.loadAndMerge(files, prefix.MAINTAIN, "date"),
              };
              break;
            case "OTHER":
              plmData = YearlyModule.loadAndMerge(files, prefix.PLM, "date");
              assistData = YearlyModule.loadAndMerge(files, prefix.ASSIST, "date");
              disableSubData = YearlyModule.loadAndMerge(files, prefix.DISABLE, "date");
              bomData = YearlyModule.loadAndMerge(files, prefix.BOM, "completeDate");
              dccData = YearlyModule.loadAndMerge(files, prefix.DCC, "date");
              break;
            case "ECRECN":
              ecrEcnData = YearlyModule.loadAndMerge(files, prefix.ECR_ECN, "ecrApplyTime");
              preprocessEcrEcnData();
              initEcrEcnYearSelect();
              break;
          }

          moduleSyncState[e] = true;
          lastSyncTime = new Date();
          saveToCache();
          updateDatalists();
          updateSyncStatus("success", formatTime(lastSyncTime));
          ToastModule.show(`${gistNames[e]} 同步完成`, "success");
          refreshCurrentPage();
        } catch (err) {
          console.error(`${e} 同步失敗:`, err);
          updateSyncStatus("stale", lastSyncTime ? `${formatTime(lastSyncTime)} (失敗)` : "載入失敗");
          ToastModule.show(`${gistNames[e]} 同步失敗`, "error");
        } finally {
          isSyncing = false;
        }
      }

      /* 手動重新整理 */
      function manualRefresh() {
        if (lastSyncTime) {
          let e = Date.now() - lastSyncTime.getTime();
          if (e < SYNC_COOLDOWN) {
            let i = Math.ceil((SYNC_COOLDOWN - e) / 1e3);
            ToastModule.show(`請等待 ${i} 秒後再重新整理`, "warning");
            return;
          }
        }
        let l = document.querySelector(".page.active"),
          n = l ? parseInt(l.id.replace("page", "")) : 2;
        [0, 1, 2, 10, 15, 16, 20].includes(n) ? syncEcnFromAPI(true, true) : [4, 5, 6].includes(n) ? loadSingleGist("BOARD") : [3, 7, 8, 9, 13].includes(n) ? syncPcbFromAPI(true, true) : [18, 11, 12, 14, 17, 19].includes(n) ? loadSingleGist("OTHER") : loadAllDataParallel(!0);
      }

      /* 假日獨立寫入 GIST (syncHolidays 內呼叫，不影響其他資料) */
      async function saveHolidaysOnly() {
        try {
          const { ID, FILES } = GIST_CONFIG.ECN;
          const res = await fetch(`${GITHUB_API_BASE}/gists/${ID}`, {
            method: "PATCH",
            headers: { Authorization: `token ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              files: {
                [FILES.HOLIDAYS]: {
                  content: JSON.stringify({
                    holidays: [...holidaySet],
                    workdays: [...workdaySet],
                    _lastUpdated: new Date().toISOString(),
                  }),
                },
              },
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          dirtySections.delete("holidays");
          return true;
        } catch (e) {
          console.warn("假日 GIST 自動儲存失敗", e);
          return false;
        }
      }

      /* 同步假日資料 */
      async function syncHolidays(e = !1) {
        const t = new Date().getFullYear(),
          a = [t, t - 1],
          r = (t) => {
            const e = String(t);
            for (const t of holidaySet) if (t.startsWith(e)) return !0;
            return !1;
          },
          n = e ? a : a.filter((e) => !r(e));
        if (0 === n.length) return void console.log("[Holiday] 資料完整，無需更新");
        console.log("[Holiday] 準備抓取:", n);
        let o = !1;
        try {
          for (const e of n)
            try {
              const t = await fetch(`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${e}.json`),
                a = await t.json();
              (a.forEach((e) => {
                const t = e.date.replace(/\//g, ""),
                  a = "六" === e.week || "日" === e.week;
                e.isHoliday && !a ? holidaySet.add(t) : e.isHoliday || !a || workdaySet.add(t);
              }),
                (o = !0),
                console.log(`[Holiday] 已載入 ${e} 年假日資料`));
            } catch (i) {
              console.warn(`無法載入 ${e} 年假日資料`, i);
            }
          if (o) {
            holidayDates = [...holidaySet];
            localStorage.setItem("ecn_holiday_cache", JSON.stringify([...holidaySet]));
            localStorage.setItem("ecn_workday_cache", JSON.stringify([...workdaySet]));
            if (isLoggedIn) {
              const ok = await saveHolidaysOnly();
              ToastModule.show(`已自動同步 ${n.join("、")} 年假日資料` + (ok ? "" : " (GIST 寫入失敗)"), ok ? "success" : "warning");
            } else {
              ToastModule.show(`已載入 ${n.join("、")} 年假日資料 (登入後會自動同步到 GIST)`, "info");
            }
          }
        } catch (s) {
          console.warn("假日同步失敗", s);
        }
      }

      /* 頁面資料儲存 */
      async function saveCurrentPageData(t, e = !1) {
        let pageConfig = FILE_PAGE_MAP[t]; 
        let pageName = "資料";
        
        if (pageConfig && FILE_NAME_MAP[pageConfig.type]) {
            pageName = FILE_NAME_MAP[pageConfig.type];
        }
        if (savingPages.has(t)) {
          if (!e) ToastModule.show(`${pageName} 儲存進行中，請稍候...`, "warning");
          return null;
        }
        savingPages.add(t);
        
        const saveBtn = document.querySelector(`[onclick="saveCurrentPageData(${t})"]`);
        const originalBtnContent = saveBtn ? saveBtn.innerHTML : null;
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span class="ml-1">儲存中...</span>';
        }
        
        try {
          let a = {
            1: {
              gist: "ECN",
              prefix: GIST_CONFIG.ECN.PREFIX.ECN,
              data: () => ecnData,
              dateField: "month",
              type: "ecn",
            },
            3: {
              gist: "PCB",
              prefix: GIST_CONFIG.PCB.PREFIX.LIST,
              data: () => pcbStore.list,
              dateField: "time3",
              type: "pcb_list",
            },
            5: {
              gist: "BOARD",
              prefix: GIST_CONFIG.BOARD.PREFIX.NEW,
              data: () => boardData.newBoard,
              dateField: "createDate",
              type: "board_new",
              getDateFn: getNewBoardSortDate,
              customSort(data) {
                data.sort((a, b) => {
                  const aKey = getNewBoardSortDate(a);
                  const bKey = getNewBoardSortDate(b);
                  if (!aKey && !bKey) return 0;
                  if (!aKey) return -1;
                  if (!bKey) return 1;
                  return String(bKey).localeCompare(String(aKey), "zh-Hant");
                });
              },
            },
            6: {
              gist: "BOARD",
              prefix: GIST_CONFIG.BOARD.PREFIX.MAINTAIN,
              data: () => boardData.maintain,
              dateField: "date",
              type: "board_maint",
            },
            8: {
              gist: "PCB",
              prefix: GIST_CONFIG.PCB.PREFIX.GPMS,
              data: () => pcbStore.gpms,
              dateField: "date",
              type: "pcb_gpms",
            },
            9: {
              gist: "PCB",
              prefix: GIST_CONFIG.PCB.PREFIX.MAINTAIN,
              data: () => pcbStore.maintain,
              dateField: "date",
              type: "pcb_maint",
            },
            11: {
              gist: "OTHER",
              prefix: GIST_CONFIG.OTHER.PREFIX.PLM,
              data: () => plmData,
              dateField: "date",
              type: "plm",
            },
            12: {
              gist: "OTHER",
              prefix: GIST_CONFIG.OTHER.PREFIX.ASSIST,
              data: () => assistData,
              dateField: "date",
              type: "assist",
            },
            14: {
              gist: "OTHER",
              prefix: GIST_CONFIG.OTHER.PREFIX.DISABLE,
              data: () => disableSubData,
              dateField: "date",
              type: "disable",
            },
            19: {
              gist: "OTHER",
              prefix: GIST_CONFIG.OTHER.PREFIX.DCC,
              data: () => dccData,
              dateField: "date",
              type: "dcc",
            },
            17: {
              gist: "OTHER",
              prefix: GIST_CONFIG.OTHER.PREFIX.BOM,
              data: () => bomData,
              dateField: "completeDate",
              type: "bom",
              getDateFn: getBOMSortDate,
              customSort(data) {
                data.sort((a, b) => {
                    const aKey = getBOMSortDate(a);
                    const bKey = getBOMSortDate(b);
                    if (!aKey && !bKey) return 0;
                    if (!aKey) return -1;
                    if (!bKey) return 1;
                    return String(bKey).localeCompare(String(aKey), "zh-Hant");
                });
              },
            },
            20: {
              gist: "ECRECN",
              prefix: GIST_CONFIG.ECRECN.PREFIX.ECR_ECN,
              data: () => ecrEcnData,
              dateField: "ecrApplyTime",
              type: "ecrecn",
            },
          };

          let i = a[t];
          if (!i) return null;

          let { ID: d } = GIST_CONFIG[i.gist];
          let p = i.data();
          trimInputsOnly(p);
          // removeInvalidRows 只跑純 GIST 頁面（有手動新增/刪除的頁）
          // API 頁面（ecn/pcb_list/pcb_gpms/ecrecn）的 row 都是 API 產生，跑清理沒必要且有誤刪風險
          const PURE_GIST_TYPES = new Set(["board_new", "board_maint", "pcb_maint", "plm", "assist", "disable", "bom", "dcc"]);
          if (PURE_GIST_TYPES.has(i.type)) {
            Utils.removeInvalidRows(p);
          }
          if (i.customSort) {
              i.customSort(p);
          } else if (i.dateField) {
              Utils.sortData(p, i.dateField, false);
          }
          let { files: r, timestamp: saveTimestamp, affectedKeys } = YearlyModule.buildDirtySaveFiles(p, i.prefix, i.dateField, i.type, i.getDateFn);

          // GPMS：有 id 是 API 列 → 只存 id + note + _override；沒 id 是 legacy 手填 → 整列保留
          if (i.type === "pcb_gpms") {
            const dirtyYears = YearlyModule.getDirtyYears(i.type);
            const overlayFiles = {};
            const overlayKeys = [];
            const ts = saveTimestamp || new Date().toISOString();
            const byYear = {};
            for (const row of p) {
              if (!row) continue;
              const dateStr = row.date || "";
              const m = dateStr.match(/^(\d{4})/);
              const year = m ? m[1] : null;
              if (!year) continue;
              let entry;
              if (row.id) {
                // API 列：精簡存 (沒 note 也沒 _override 就跳過不存)
                entry = { id: row.id, date: row.date };
                if (row.note) entry.note = row.note;
                if (row._override && typeof row._override === "object") entry._override = row._override;
                if (!entry.note && !entry._override) continue;
              } else {
                // Legacy 手填列：整列保留
                const { _dirty, _isNew, _origIdx, ...rest } = row;
                entry = rest;
              }
              if (!byYear[year]) byYear[year] = [];
              byYear[year].push(entry);
            }
            for (const year of dirtyYears) {
              const records = byYear[year] || [];
              const fname = `${i.prefix}${year}.json`;
              overlayFiles[fname] = { content: JSON.stringify({ _lastUpdated: ts, records }) };
              overlayKeys.push(`${i.prefix}${year}`);
            }
            r = overlayFiles;
            affectedKeys = overlayKeys;
            saveTimestamp = ts;
          }

          // ECN/PCB 走 overlay 格式（只存使用者編輯欄位）；Transfer 純讀不存
          if (i.type === "ecn" || i.type === "pcb_list") {
            const dirtyYears = YearlyModule.getDirtyYears(i.type);
            const overlayFiles = {};
            const overlayKeys = [];
            const ts = saveTimestamp || new Date().toISOString();
            const byYear = i.type === "ecn"
              ? OverlayModule.buildEcnByYear(p)
              : OverlayModule.buildPcbByYear(p);
            const overlayPrefix = i.type === "ecn"
              ? GIST_CONFIG.ECN.PREFIX.ECN
              : GIST_CONFIG.PCB.PREFIX.LIST;
            for (const year of dirtyYears) {
              const records = byYear[year] || [];
              const fname = `${overlayPrefix}${year}.json`;
              overlayFiles[fname] = {
                content: JSON.stringify({ _lastUpdated: ts, records }),
              };
              overlayKeys.push(`${overlayPrefix}${year}`);
            }
            r = overlayFiles;
            affectedKeys = overlayKeys;
            saveTimestamp = ts;
          }

          if (1 === t && dirtySections.has("holidays")) {
            r[GIST_CONFIG.ECN.FILES.HOLIDAYS] = {
              content: JSON.stringify({
                holidays: [...holidaySet],
                workdays: [...workdaySet],
                _lastUpdated: new Date().toISOString(),
              }),
            };
          }

          if (0 === Object.keys(r).length) {
            e || ToastModule.show(`${pageName} 無變更需要儲存`, "info");
            dirtySections.delete(t);
            deletedPages.delete(t);
            updateSaveButtonStatus();
            return null;
          }

          if (!e) ToastModule.show(`⏳ ${pageName} 正在儲存...`, "info");

          const checkResult = await quickConflictCheck(i.gist, i.prefix, i.type);
          if (checkResult.hasConflict) {
            const conflictInfo = checkResult.conflicts.map((c) => `• ${c.year} 年：伺服器 ${c.serverTime}`).join("\n");

            const proceed = confirm(`⚠️ 偵測到資料已被其他人更新！\n\n` + `衝突的年份：\n${conflictInfo}\n\n` + `建議先點擊「重新整理」同步最新資料。\n\n` + `點擊「確定」→ 強制儲存（會覆蓋他人變更）\n` + `點擊「取消」→ 放棄儲存`);

            if (!proceed) {
              ToastModule.show("已取消儲存，請先重新同步", "info");
              return null;
            }
          }

          try {
            let s = await fetch(`${GITHUB_API_BASE}/gists/${d}`, {
              method: "PATCH",
              headers: {
                Authorization: `token ${GITHUB_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ files: r }),
            });
            if (!s.ok) throw Error(`HTTP ${s.status}`);
            if (saveTimestamp && affectedKeys.length > 0) {
              YearlyModule.applyTimestamps(affectedKeys, saveTimestamp);
            }
            if (i.type === "ecn") OverlayModule.loadEcnFromArray(p);
            else if (i.type === "pcb_list") OverlayModule.loadPcbFromArray(p);
            YearlyModule.clearDirty(i.type);
            const dataArray = i.data();
            if (Array.isArray(dataArray)) {
              dataArray.forEach(record => {
                if (record) {
                  delete record._dirty;
                  delete record._isNew;
                }
              });
            }
            deletedPages.delete(t);
            let l = FILE_PAGE_MAP[t];
            let n = FILE_NAME_MAP[l.type] || l.type;
            e || ToastModule.show(`${n} 已成功儲存`, "success");
            dirtySections.delete(t);
            if (1 === t) dirtySections.delete("holidays");
            updateSaveButtonStatus();
            let o = parseInt(document.querySelector(".page.active")?.id?.replace("page", ""));
            if (o === t) refreshCurrentPage();
            return n;
          } catch (y) {
            console.error(y);
            throw y;
          }
        } finally {
          savingPages.delete(t);
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalBtnContent || '<i class="fa-solid fa-floppy-disk"></i><span class="ml-1">儲存</span>';
          }
        }
      }

      /* 觸發變更標記 */
      function triggerChange(r, n = null, l = null) {
        const alreadyDirty = n && typeof n === "object" && n._dirty === true;
        if (n && typeof n === "object") {
          if (!alreadyDirty) {
            n._dirty = true;
            const idx = n._origIdx ?? n._idx;
            if (idx !== undefined) {
              const row = document.querySelector(`tr[data-idx="${idx}"]`);
              if (row && !row.classList.contains("row-dirty")) {
                row.classList.add("row-dirty");
              }
            }
          }
        }
        if (n && l) {
          YearlyModule.markDirtyFromRecord(l, n);
        }
        if (!alreadyDirty) {
          updateSaveButtonStatus();
        }
      }

      /* 檢查資料陣列是否有任何 _dirty 標記 */
      function hasDirtyRecords(dataArray) {
        if (!Array.isArray(dataArray)) return false;
        return dataArray.some(record => record && record._dirty === true);
      }

      /* 更新儲存按鈕狀態 */
      function updateSaveButtonStatus() {
        const fab = document.getElementById("unsavedFab");
        const badgeText = document.getElementById("unsavedBadgeText");
        if (!fab) return;
        const dirtyPageIds = new Set();
        const pageDataMap = {
          1: { data: ecnData, name: "ECN 清單" },
          3: { data: pcbStore.list, name: "PCB 清單" },
          5: { data: boardData.newBoard, name: "新建板階" },
          6: { data: boardData.maintain, name: "板階維護" },
          8: { data: pcbStore.gpms, name: "GPMS 啟動" },
          9: { data: pcbStore.maintain, name: "PCB 維護" },
          11: { data: plmData, name: "資料匯出" },
          12: { data: assistData, name: "協助項目" },
          14: { data: disableSubData, name: "停用取替代" },
          17: { data: bomData, name: "BOM 建立" },
          19: { data: dccData, name: "管制文件申請" },
          20: { data: ecrEcnData, name: "ECR/ECN 追蹤" },
        };
        
        const dirtyNames = [];
        for (const [pageId, info] of Object.entries(pageDataMap)) {
          const pid = parseInt(pageId);
          if (hasDirtyRecords(info.data) || deletedPages.has(pid)) {
            dirtyPageIds.add(pid);
            dirtyNames.push(info.name);
          }
        }
        const shouldShow = isLoggedIn && dirtyNames.length > 0;
        fab.style.display = shouldShow ? "block" : "none";
        
        if (badgeText && shouldShow) {
          badgeText.textContent = `${dirtyNames.join("、")} 未存`;
        }
      }

      /* 同步狀態 UI */
      function updateSyncStatus(t, s) {
        let e = document.getElementById("syncStatus"),
          n = document.getElementById("syncIcon"),
          a = document.getElementById("syncText");
        e && ((e.className = "sync-status " + t), "syncing" === t ? (n.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i>') : "success" === t ? (n.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i>') : (n.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>'), s && (a.textContent = s));
      }
      function checkSyncStale() {
        if (!lastSyncTime || isSyncing) return;
        let e = new Date(lastSyncTime);
        if (isNaN(e.getTime())) return;
        let t = Date.now() - e.getTime(),
          n = document.getElementById("syncStatus");
        if (n && !n.classList.contains("syncing")) {
          let c = formatTime(e),
            s = Math.floor(t / 6e4);
          if (s >= 60) c += ` (${Math.floor(s / 60)}小時前)`;
          else if (s >= 1) c += ` (${s}分鐘前)`;
          // 超過快取期限自動轉 stale，否則維持 success
          updateSyncStatus(t > CACHE_MAX_AGE ? "stale" : "success", c);
        }
      }
      function formatTime(i) {
        return i
          ? i.toLocaleTimeString("zh-TW", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "--:--";
      }

      // ==========================================
      // 7. 登入與權限控制 (Authentication)
      // ==========================================

      /* 登入視窗切換 */
      function toggleLogin() {
        isLoggedIn ? logout() : document.getElementById("loginModal").classList.remove("hidden");
      }
      function closeLogin() {
        document.getElementById("loginModal").classList.add("hidden");
      }

      /* 驗證登入 */
      function checkLogin() {
        const u = document.getElementById("loginUser").value.trim();
        const p = document.getElementById("loginPass").value.trim();
        if (!u && !p) { ToastModule.show("請輸入帳號和密碼", "warning"); return; }
        if (!u) { ToastModule.show("請輸入帳號", "warning"); return; }
        if (!p) { ToastModule.show("請輸入密碼", "warning"); return; }
        const staticValid = APP_CONFIG.CREDENTIALS.find((c) => c.user === u && c.pass === p);
        const dynamicValid = settingsData.maintainers.find((m) => m.active && m.id && m.id === u && m.id === p);
        if (staticValid || dynamicValid) {
          isLoggedIn = true;
          document.getElementById("loginModal").classList.add("hidden");
          const welcomeName = dynamicValid ? dynamicValid.name : "管理員";
          ToastModule.show(`登入成功！歡迎 ${welcomeName}`, "success");
          const navText = document.getElementById("navLoginText");
          if (navText) navText.innerText = "登出";
          updateAuthUI();
          refreshCurrentPage();
        } else {
          ToastModule.show("帳號或密碼錯誤", "error");
          document.getElementById("loginPass").value = "";
        }
      }

      /* 登出 */
      function logout() {
        isLoggedIn = false;
        ToastModule.show("已登出", "info");
        updateAuthUI();
        const activePage = document.querySelector(".page.active");
        if (activePage) {
          const pid = parseInt(activePage.id.replace("page", ""));
          switchPage(pid);
        }
      }

      /* 權限 UI 更新 */
      function updateAuthUI() {
        const navText = document.getElementById("navLoginText");
        if (navText) navText.innerText = isLoggedIn ? "登出" : "登入";
        if (isLoggedIn) {
          document.querySelectorAll(".auth-only").forEach((el) => {
            el.classList.remove("auth-only");
            el.classList.add("auth-visible");
          });
        } else {
          document.querySelectorAll(".auth-visible").forEach((el) => {
            el.classList.add("auth-only");
            el.classList.remove("auth-visible");
          });
        }
        updateSaveButtonStatus();
      }

      // ==========================================
      // 8. 路由與頁面切換 (Router)
      // ==========================================

      /* 頁面切換 */
      async function switchPage(e) {
      FlatpickrManager.destroyAll();

        document.querySelectorAll(".page").forEach((e) => e.classList.remove("active"));
        let t = document.getElementById("page" + e);
        t && t.classList.add("active");

        // P0/P1/P2/P10/P15/P16/P20 走 API
        if ([0, 1, 2, 10, 15, 16, 20].includes(e)) {
          renderPageUI(e);
          const stale = Date.now() - lastToastTime.ECN > TOAST_QUIET_PERIOD;
          syncEcnFromAPI(stale, stale);
          if (stale) lastToastTime.ECN = Date.now();
          moduleSyncState.ECN = true;
          return;
        }

        // P3/P7/P8/P9/P13：P3/P8 走 API；P9 讀 PCB GIST overlay
        if ([3, 7, 8, 9, 13].includes(e)) {
          renderPageUI(e);
          const stale = Date.now() - lastToastTime.PCB > TOAST_QUIET_PERIOD;
          syncPcbFromAPI(stale, stale);
          if (stale) lastToastTime.PCB = Date.now();
          moduleSyncState.PCB = true;
          return;
        }

        let a = {
          4: "BOARD", 5: "BOARD", 6: "BOARD",
          11: "OTHER", 12: "OTHER", 14: "OTHER", 17: "OTHER", 18: "OTHER", 19: "OTHER",
        }[e];
        if (a && !isSyncing) {
          const stale = Date.now() - (lastToastTime[a] || 0) > TOAST_QUIET_PERIOD;
          if (!moduleSyncState[a] || stale) {
            loadSingleGist(a).then(() => {
              const t = document.querySelector(".page.active");
              t && t.id === "page" + e && renderPageUI(e);
            });
            lastToastTime[a] = Date.now();
          }
        }
        renderPageUI(e);
      }

      /* 頁面 UI 渲染分派 */
      function renderPageUI(pageId) {
        switch (pageId) {
          case 1:
            renderTable();
            break;
          case 2:
            renderCharts();
            renderYearlyTable();
            break;
          case 3:
            renderPCBKPITable();
            break;
          case 4:
            renderBoardCharts();
            break;
          case 5:
            renderNewBoardPage();
            break;
          case 6:
            renderMaintainPage();
            break;
          case 7:
            renderPCBReport();
            break;
          case 8:
            renderGPMSPage();
            break;
          case 9:
            renderPCBMaintainPage();
            break;
          case 10:
            renderTransferPage();
            break;
          case 11:
            renderPLMPage();
            break;
          case 12:
            renderAssistPage();
            break;
          case 14:
            renderDisablePage();
            break;
          case 15:
            renderSettingsPage();
            break;
          case 16:
            renderOptionSettingsPage();
            break;
          case 17:
            renderBOMPage();
            break;
          case 18:
            renderOtherReport();
            break;
          case 19:
            renderDccPage();
            break;
          case 20:
            renderEcrEcnPage();
            break;
        }
      }

      /* 重新整理當前頁面 */
      function refreshCurrentPage() {
        const p = document.querySelector(".page.active");
        if (p) switchPage(parseInt(p.id.replace("page", "")));
      }

      // ==========================================
      // 9. ECN 模組 (Page 1, 2, 10)
      // ==========================================

      /* ECN JSON 匯入 (Console 工具產出的 {ecnList, transfer} 格式) */
      function handleEcnJsonImport(input) {
        const file = input.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const json = JSON.parse(e.target.result);
            // 支援兩種格式: {ecnList, transfer} 或純陣列
            let newEcnData, newTransfer;
            if (json.ecnList) {
              newEcnData = json.ecnList;
              newTransfer = json.transfer || [];
            } else if (Array.isArray(json)) {
              newEcnData = json;
              newTransfer = [];
            } else { ToastModule.show('JSON 格式不正確', 'warning'); return; }

            // ECN 清單合併
            const PRESERVE = ['plmStart','plmRelease','complexity','overdueNote'];
            let c = new Map(ecnData.map(e => [e.id, e]));
            let added = 0, updated = 0, unchanged = 0;
            const ns = v => (v || '').trim();
            const nb = v => !!v;

            for (const r of newEcnData) {
              if (!r.id) continue;
              r.status = StatusModule.normalize(r.status);

              const ex = c.get(r.id);
              if (ex) {
                let merged = { ...ex }, changed = false;
                if (ns(ex.status) !== ns(r.status)) { merged.status = r.status; changed = true; }
                if (r.approver && ns(r.approver)!=='-' && ns(ex.approver) !== ns(r.approver)) { merged.approver = r.approver; changed = true; }
                if (r.approveTime && ns(ex.approveTime) !== ns(r.approveTime)) { merged.approveTime = r.approveTime; changed = true; }
                if (r.approveTime1 && ns(ex.approveTime1) !== ns(r.approveTime1)) { merged.approveTime1 = r.approveTime1; changed = true; }
                if (nb(ex.isRejected) !== nb(r.isRejected)) { merged.isRejected = r.isRejected; changed = true; }
                if (nb(ex.isRejected1) !== nb(r.isRejected1)) { merged.isRejected1 = r.isRejected1; changed = true; }
                if (r.partNo && ns(r.partNo)!=='-' && ns(ex.partNo)!==ns(r.partNo)) merged.partNo = r.partNo;
                if (r.scope && ns(r.scope)!=='-' && ns(ex.scope)!==ns(r.scope)) merged.scope = r.scope;
                if (r.changeReason && ns(r.changeReason)!=='-' && ns(ex.changeReason)!==ns(r.changeReason)) merged.changeReason = r.changeReason;
                if (r.ecrId && ns(r.ecrId)!=='-' && ns(ex.ecrId)!==ns(r.ecrId)) merged.ecrId = r.ecrId;
                if (r.priority && ns(ex.priority)!==ns(r.priority)) merged.priority = r.priority;
                if (changed) {
                  for (const f of PRESERVE) merged[f] = ex[f] || '';
                  merged._dirty = true;
                  c.set(r.id, merged);
                  YearlyModule.markDirtyFromRecord('ecn', merged);
                  updated++;
                } else { c.set(r.id, merged); unchanged++; }
              } else {
                r._dirty = true;
                c.set(r.id, r);
                YearlyModule.markDirtyFromRecord('ecn', r);
                added++;
              }
            }
            ecnData = Array.from(c.values());
            trimInputsOnly(ecnData);
            ecnData.sort((a, b) => (b.id || '').localeCompare(a.id || ''));

            // 轉單合併 (key = formId+type+approveDate+arriveDate+result)
            let tAdded = 0, tUpdated = 0;
            if (newTransfer.length > 0) {
              const makeKey = (r) => `${r.formId}|${r.type||'ECN'}|${ns(r.approveDate)}|${ns(r.arriveDate)}|${ns(r.result)}`;
              const tMap = new Map(transferData.map((e, i) => [makeKey(e), i]));
              for (const r of newTransfer) {
                // BPM: []-人名 動作名稱缺失，過濾掉
                if ((r.result || '').startsWith('[]-')) continue;
                const key = makeKey(r);
                if (tMap.has(key)) {
                  const idx = tMap.get(key);
                  const ex = transferData[idx];
                  const comment = ex.comment || r.comment || '';
                  if (ns(ex.arriveDate) !== ns(r.arriveDate) || ns(ex.result) !== ns(r.result) || ns(ex.executor) !== ns(r.executor)) {
                    Object.assign(ex, r);
                    ex.comment = comment;
                    ex._dirty = true;
                    YearlyModule.markDirtyFromRecord('transfer', ex);
                    tUpdated++;
                  }
                } else {
                  r._dirty = true;
                  transferData.unshift(r);
                  tMap.clear();
                  transferData.forEach((e, i) => tMap.set(makeKey(e), i));
                  tAdded++;
                }
              }
              if (tAdded > 0) {
                transferData.sort((a, b) => (b.approveDate || '').localeCompare(a.approveDate || ''));
              }
              transferData.forEach((r) => {
                if (r._dirty) YearlyModule.markDirtyFromRecord('transfer', r);
              });
            }

            (added > 0 || updated > 0) && triggerChange(1);
            (tAdded > 0 || tUpdated > 0) && triggerChange(10);
            document.getElementById('ecnYearlyTableSelect').innerHTML = '';
            renderYearlyTable();
            renderTable();
            syncHolidays();
            updateMonthSelect();
            let msg = `ECN 匯入完成：新增 ${added}、更新 ${updated}`;
            if (newTransfer.length > 0) msg += ` / 轉單 新增 ${tAdded}、更新 ${tUpdated}`;
            ToastModule.show(msg, added > 0 || updated > 0 || tAdded > 0 || tUpdated > 0 ? 'success' : 'info');
          } catch (err) { console.error(err); ToastModule.show('JSON 解析失敗: ' + err.message, 'error'); }
        };
        reader.readAsText(file); input.value = '';
      }

      /* ECN 表格渲染 */
      function renderTable() {
        SyncTimeModule.update("fileTime_p1", 1);
        let e = document.querySelector("#mainTable tbody");
        if (!e) return;
        let t = [...new Set(ecnData.map((e) => e.month?.substring(0, 4)).filter((e) => e))].sort().reverse();
        Utils.initYearSelect("ecnYearSelect", t, "年", !0);
        let a = document.getElementById("ecnYearSelect")?.value,
          { ro: roAttr, dis: disAttr, inputCls } = Utils.authAttrs(),
          inputFull = inputCls + " w-full",
          d = document.getElementById("searchBox_p1")?.value || "",
          c = ecnData.map((e, t) => {
            const isTarget = isKPITarget(e.approver);
            const rej = e.isRejected || e.isRejected1;
            const isVoid = StatusModule.isVoid(e.status);
            const skip = rej || isVoid;
            const transferDate = skip ? "" : (e.arriveDate || "");
            const closeDays = skip ? null : DateUtils.calcWorkDays(e.applyTime, e.approveTime);
            const overdueDays = isTarget && !skip && transferDate ? DateUtils.calcWorkDays(transferDate, e.approveTime) : null;
            const limit = OverdueModule.getThresholdPage1(e.priority, e.complexity);
            const isOverdue = isTarget && !skip && limit && typeof overdueDays === "number" && overdueDays > limit;
            return {
              ...e,
              _origIdx: t,
              _closeDays: closeDays,
              _ecWorkDays: isTarget && !skip && transferDate ? DateUtils.calcWorkDays(transferDate, e.approveTime) : null,
              _isOverdue: isOverdue ? "逾期" : ""
            };
          }),
          n = SearchModule.filterData(c, "p1", d, !1, (e) => !a || "ALL" === a || !e.month || e.month.startsWith(a));
        renderPaginationControls("pagination_p1", "p1", n.length, "renderTable");
        let i = getPaginatedData(n, "p1");
        ((e.innerHTML = i
          .map((e) => {
            let t = isKPITarget(e.approver),
            rej = e.isRejected || e.isRejected1,
            isVoid = StatusModule.isVoid(e.status),
            skip = rej || isVoid,
            a = skip ? "-" : DateUtils.calcWorkDays(e.applyTime, e.approveTime),
            transferDate = skip ? "" : (e.arriveDate || ""),
            overdueDays = t && !skip && transferDate ? DateUtils.calcWorkDays(transferDate, e.approveTime) : null,
            l = t && !skip ? DateUtils.calcWorkDays(transferDate, e.plmStart) : "-",
            r = t && !skip ? DateUtils.calcWorkDays(e.plmStart, e.plmRelease) : "-",
            d = t && !skip ? DateUtils.calcWorkDays(e.plmRelease, e.approveTime) : "-",
            c = "p-2 border-b align-top",
            cc = "p-2 border-b align-top text-center",
            cb = "p-2 border-b align-top text-center font-bold",
            plmLocked = !t || skip;
            return `<tr class="transition-colors hover:bg-gray-50 ${e._dirty ? "row-dirty" : ""}" data-idx="${e.id}">
                  <td class="${cb} text-ms-blue sticky-col-cell">${e.id}</td>
                  <td class="${c}">${e.ecrId}</td>
                  <td class="${cc}"><span class="${getBadgeClass(e.status)}">${e.status}</span></td>
                  <td class="${c}">${e.applicant}</td>
                  <td class="${c}"><div class="overflow-y-auto max-h-[100px] text-gray-600 leading-snug whitespace-normal break-words">${Utils.formatPartNo(e.partNo)}</div></td>
                  <td class="${c}">${e.approver}</td>
                  <td class="${cc}">${e.priority || ""}</td>
                  <td class="${c}"><div class="overflow-y-auto max-h-[100px] leading-snug whitespace-normal break-words">${e.changeReason || ""}</div></td>
                  <td class="${c}"><div class="overflow-y-auto max-h-[100px] leading-snug whitespace-normal break-words">${e.scope || ""}</div></td>
                  <td class="${cc}">${DateUtils.formatDisplay(e.applyTime)}</td>
                  <td class="${cc} px-0.5">${e.approveTime1 ? DateUtils.formatDisplay(e.approveTime1) + (e.isRejected1 ? '<span class="ml-0.5 font-bold text-[10px] text-red-500 tracking-tighter">(駁)</span>' : isVoid && e.status === "表單撤回" ? '<span class="ml-0.5 font-bold text-[10px] text-red-500 tracking-tighter">(撤)</span>' : "") : "-"}</td>
                  <td class="${cc} px-0.5">${e.approveTime ? DateUtils.formatDisplay(e.approveTime) + (e.isRejected ? '<span class="ml-0.5 font-bold text-[10px] text-red-500 tracking-tighter">(駁)</span>' : "") : "-"}</td>
                  <td class="${cb} bg-green-50 border-green-700/10 !text-emerald-700">${a}${"number" == typeof a ? "天" : ""}</td>
                  <td class="${cc}">${transferDate ? DateUtils.formatDisplay(transferDate) : "-"}</td>
                  <td class="${cc}">${
                    t && !rej
                      ? `<select class="${inputFull}" style="text-align-last:center" ${disAttr} onchange="updateVal('${e.id}','complexity',this.value)">
                        <option value="" ${!e.complexity ? "selected" : ""}></option>
                        <option value="一般" ${e.complexity === "一般" ? "selected" : ""}>一般</option>
                        <option value="複雜" ${e.complexity === "複雜" ? "selected" : ""}>複雜</option></select>`
                      : '<span class="text-gray-300">-</span>'}</td>
                  <td class="${cc}">${plmLocked ? '<span class="text-gray-300">-</span>' : `<input type="text" value="${DateUtils.formatDisplay(e.plmStart)}" class="${inputFull} flatpickr-date text-center" ${roAttr} data-ecn-id="${e.id}" data-field="plmStart" placeholder="選擇日期">`}</td>
                  <td class="${cc}">${plmLocked ? '<span class="text-gray-300">-</span>' : `<input type="text" value="${DateUtils.formatDisplay(e.plmRelease)}" class="${inputFull} flatpickr-date text-center" ${roAttr} data-ecn-id="${e.id}" data-field="plmRelease" placeholder="選擇日期">`}</td>
                  <td class="${cb} bg-blue-50 border-blue-700/10 ${skip ? "text-gray-300" : "text-ms-blue"}">${t ? (skip ? "-" : l + "天") : '<span class="text-gray-300">-</span>'}</td>
                  <td class="${cb} bg-blue-50 border-blue-700/10 ${skip ? "text-gray-300" : "text-ms-blue"}">${t ? (skip ? "-" : r + "天") : '<span class="text-gray-300">-</span>'}</td>
                  <td class="${cb} bg-blue-50 border-blue-700/10 ${skip ? "text-gray-300" : "text-ms-blue"}">${t ? (skip ? "-" : d + "天") : '<span class="text-gray-300">-</span>'}</td>
                  <td class="${cb} bg-yellow-50 border-yellow-700/10 !text-amber-700">${!t || skip ? '<span class="text-gray-300">-</span>' : (typeof overdueDays === "number" ? overdueDays : '<i class="fa-solid fa-calendar-clock text-sm text-gray-300"></i>')}</td>
                  <td class="${cb} bg-red-50 border-red-700/10">${(() => {
                    if (!t || rej) return '<span class="text-gray-300">-</span>';
                    const limit = OverdueModule.getThresholdPage1(e.priority, e.complexity);
                    const isOverdue = limit && typeof overdueDays === "number" && overdueDays > limit;
                    return isOverdue ? `<span class="text-red-500">${overdueDays - limit}</span>` : '<span class="text-gray-300">-</span>';
                  })()}</td>
                  <td class="${cc} bg-red-50 border-red-700/10 group">${(() => {
                    if (!t || rej) return '<span class="text-gray-300">-</span>';
                    const isOverdue = OverdueModule.isOverduePage1(e.priority, e.complexity, overdueDays);
                    if (!isOverdue && !e.overdueNote) {
                      return isLoggedIn
                        ? `<button class="flex text-sm opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-600 transition-opacity" onclick="enableNoteEdit(this, '${e.id}')" title="新增說明"><i class="fa-solid fa-pen-to-square"></i></button>`
                        : '<div style="min-height:24px"></div>';
                    }
                    return `<textarea rows="1" class="${isLoggedIn ? "table-input w-full overflow-hidden resize-none leading-relaxed text-xs" : "table-input w-full overflow-hidden resize-none leading-relaxed bg-transparent border-none cursor-default text-xs"}" style="min-height:24px;field-sizing:content" placeholder="逾期說明" ${roAttr} oninput="Utils.autoResize(this)" onchange="updateVal('${e.id}','overdueNote',this.value)">${Utils.escapeHtml(e.overdueNote)}</textarea>`;
                  })()}</td></tr>`;
          })
          .join("")),
          FlatpickrManager.init(".flatpickr-date", (e, t) => {
            updateVal(e.dataset.ecnId, e.dataset.field, t);
          }));

        // P1 表頭拖曳初始化
        const p1Thead = document.querySelector("#mainTable thead tr");
        if (p1Thead) {
          ColumnOrderModule.initDraggable("#mainTable", "p1", () => renderTable());
          reorderP1TableBody();
        }
      }
      function reorderP1TableBody() {
        const order = ColumnOrderModule.getOrder("p1"),
          colIds = ["ecnId", "ecrId", "status", "applicant", "partNo", "approver", "priority", "changeReason", "scope", "applyTime", "approveTime1", "approveTime", "closeDays", "transferDate", "complexity", "plmStart", "plmRelease", "kpi1", "kpi2", "kpi3", "ecWorkDays", "overdue", "overdueNote"];
        const tbody = document.querySelector("#mainTable tbody");
        if (!tbody || !order.length) return;
        ColumnOrderModule.applyColgroupOrder("#mainTable", "p1");
        tbody.querySelectorAll("tr").forEach((row) => {
          const tds = Array.from(row.children);
          order.forEach((id) => {
            const idx = colIds.indexOf(id);
            if (idx >= 0 && tds[idx]) row.appendChild(tds[idx]);
          });
        });
      }

      /* 非逾期手動新增逾期說明(目前只有P1) */
      function enableNoteEdit(btn, ecnId) {
        const td = btn.parentElement;
        const iconHtml = btn.outerHTML;
        td.innerHTML = `<textarea rows="1" class="table-input w-full overflow-hidden resize-none leading-relaxed text-xs" style="min-height:24px;field-sizing:content" placeholder="輸入說明..." oninput="Utils.autoResize(this)" onchange="updateVal('${ecnId}','overdueNote',this.value)"></textarea>`;
        const ta = td.querySelector("textarea");
        ta.addEventListener("blur", () => {
          if (!ta.value.trim()) td.innerHTML = iconHtml;
        });
        ta.focus();
      }

      /* ECN 資料更新 */
      function updateVal(n, d, e) {
        let i = ecnData.find((d) => d.id === n);
        if (!i || (i[d] || "") === (e || "")) return;
        i[d] = e;
        if (OverlayModule.ECN_FIELDS.includes(d)) {
          const o = OverlayModule.extractEcnFields(i);
          if (OverlayModule.hasEcnContent(o)) OverlayModule.ecn.set(n, o);
          else OverlayModule.ecn.delete(n);
        }
        triggerChange(1, i, "ecn");
        renderTable();
      }

      /* ECN 排序處理 */
      function handleSort(e, a = !0) {
        (a && (sortConfig.key === e ? (sortConfig.asc = !sortConfig.asc) : ((sortConfig.key = e), (sortConfig.asc = !0))),
          Utils.sortData(ecnData, sortConfig.key, sortConfig.asc),
          (paginationState.p1 = 1),
          renderTable(),
          ["id", "ecrId", "applyTime", "approveTime1", "approveTime"].forEach((e) => {
            let a = document.getElementById("sort_" + e);
            a && (a.innerHTML = Utils.getSortIcon(sortConfig.key === e, sortConfig.asc));
          }));
      }

      /* ECN 統計計算 */
      function getStats(e) {
        let t = e.length || 0,
          l = (e) => (e.status || "").toString(),
          r = e.filter((e) => {
            let t = l(e);
            return t.includes("駁回") || t.includes("撤回");
          }).length,
          n = e.filter((e) => {
            let t = l(e);
            return (t.includes("同意") || t.includes("結束")) && !t.includes("駁回") && !t.includes("撤回");
          }),
          i = n.length,
          p = n.filter((e) => isKPITarget(e.approver)).length,
          g = n.filter((e) => !isKPITarget(e.approver)).length,
          o = e.filter((e) => "進行中" === l(e)),
          u = o.length,
          a = o.filter((e) => e.approveTime && isKPITarget(e.approver)).length,
          c = o.filter((e) => e.approveTime && !isKPITarget(e.approver)).length,
          f = n.map((e) => DateUtils.calcWorkDays(e.applyTime, e.approveTime)),
          h = f.filter((e) => "-" !== e && e <= 20).length,
          s = f.filter((e) => "-" !== e && e > 20 && e <= 30).length,
          d = f.filter((e) => "-" !== e && e > 30).length,
          $ = (e, t) => (t > 0 ? Math.round((e / t) * 100) : 0);
        return {
          total: t,
          closedCount: i,
          voidCount: r,
          totalOngoing: u,
          ecClosed: a,
          otherSigned: c,
          pureOngoing: u - a - c,
          ecClosedFinal: p,
          otherClosedFinal: g,
          closedPct: $(i, t),
          onPct: $(u, t),
          voidPct: $(r, t),
          b1: h,
          b2: s,
          b3: d,
          p1: $(h, t),
          p2: $(s, t),
          p3: $(d, t),
        };
      }

      /* ECN 報表渲染 */
      function renderCharts() {
        const m = document.getElementById("monthSelect").value;
        if (m && m.length >= 4) {
          const selectedYear = m.substring(0, 4);
          const yearSelect = document.getElementById("ecnYearlyTableSelect");
                    if (yearSelect && yearSelect.value !== selectedYear) {
            const hasYear = [...yearSelect.options].some(opt => opt.value === selectedYear);
            if (hasYear) {
              yearSelect.value = selectedYear;
              setTimeout(() => renderYearlyTable(), 0);
            }
          }
        }
        const data = ecnData.filter((r) => r.month === m);
        if (data.length === 0) {
          document.getElementById("summaryGrid").innerHTML = "";
          if (cS) {
            cS.destroy();
            cS = null;
          }
          if (cD) {
            cD.destroy();
            cD = null;
          }
          return;
        }
        const s = getStats(data),
          techClosedCount = s.ecClosed + s.otherSigned;
        const cb = "relative rounded-xl p-5 shadow-md border border-gray-200 flex flex-col justify-between h-36",
          lc = "text-sm font-bold opacity-90 tracking-wide",
          nc = "text-4xl font-black tracking-tight mt-1",
          bb = "px-3 py-1 rounded-full text-xs font-bold shadow-sm ml-auto";
        document.getElementById("summaryGrid")
        .innerHTML = `<div class="${cb} bg-slate-50 text-slate-700"><div><div class="${lc}">本月申請總數</div><div class="${nc}">${s.total}</div></div></div>
                    <div class="${cb} bg-emerald-50 text-emerald-800"><div class="flex items-start justify-between w-full"><div><div class="${lc} text-emerald-700">已結案</div><div class="${nc}">${s.closedCount}</div></div><div class="${bb} bg-white text-emerald-600">${Math.round((s.closedCount / s.total) * 100) || 0}%</div></div><div class="mt-auto"><div class="flex gap-3 mb-1.5 font-bold text-xs opacity-80"><span class="flex items-center gap-1"><span class="w-1.5 h-1.5 bg-emerald-600 rounded-full"></span>EC ${s.ecClosedFinal}</span><span class="flex items-center gap-1"><span class="w-1.5 h-1.5 bg-emerald-400 rounded-full"></span>協辦 ${s.otherClosedFinal}</span></div><div class="flex overflow-hidden w-full h-2 bg-emerald-200/50 rounded-full shadow-inner"><div class="h-full bg-emerald-600 border-r border-emerald-500/20" style="width: ${(s.ecClosedFinal / s.closedCount) * 100}%"></div><div class="h-full bg-emerald-400 border-r border-emerald-300/20" style="width: ${(s.otherClosedFinal / s.closedCount) * 100}%"></div></div></div></div>
                    <div class="${cb} bg-indigo-50 text-indigo-900"><div class="flex items-start justify-between w-full"><div><div class="${lc} text-indigo-700">進行中</div><div class="${nc} text-indigo-800">${s.totalOngoing}</div></div><div class="${bb} bg-white text-indigo-600">${s.onPct}%</div></div><div class="mt-auto"><div class="flex gap-3 mb-1.5 font-bold text-xs opacity-80"><span class="flex items-center gap-1"><span class="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>EC ${s.ecClosed}</span><span class="flex items-center gap-1"><span class="w-1.5 h-1.5 bg-sky-400 rounded-full"></span>協辦 ${s.otherSigned}</span><span class="flex items-center gap-1 text-slate-400"><span class="w-1.5 h-1.5 bg-slate-300 rounded-full"></span>待簽 ${s.pureOngoing}</span></div><div class="flex overflow-hidden w-full h-2 bg-slate-200 rounded-full shadow-inner"><div class="h-full bg-indigo-600 border-r border-indigo-500/20" style="width: ${(s.ecClosed / s.totalOngoing) * 100}%"></div><div class="h-full bg-sky-400 border-r border-sky-300/20" style="width: ${(s.otherSigned / s.totalOngoing) * 100}%"></div></div></div></div>
                    <div class="${cb} bg-red-50 text-red-900"><div class="flex items-start justify-between w-full"><div><div class="${lc} text-red-700">作廢 / 撤回</div><div class="${nc} text-red-800">${s.voidCount}</div></div><div class="${bb} bg-white text-red-600">${s.voidPct}%</div></div><div class="mt-auto font-medium text-xs text-red-400/80">含駁回與申請人撤回</div></div>`;

        if (cS) {
          cS.destroy();
          cS = null;
        }
        cS = new Chart(document.getElementById("chartStatus").getContext("2d"), {
          type: "doughnut",
          data: {
            labels: [`已結案`, `進行中(已執行)`, `尚未執行`, `作廢`],
            datasets: [
              {
                data: [s.closedCount, techClosedCount, s.pureOngoing, s.voidCount],
                backgroundColor: ["#10b981", "#6366f1", "#cbd5e1", "#ef4444"],
                borderWidth: 2,
                borderColor: "#ffffff",
                hoverOffset: 4,
              },
            ],
          },
          options: {
            maintainAspectRatio: false,
            layout: { padding: { left: 10, bottom: 10 } },
            plugins: {
              legend: {
                display: true,
                position: "left",
                align: "end",
                labels: { boxWidth: 12, font: { size: 13 }, padding: 15 },
              },
              centerText: { text: s.total.toString() },
              datalabels: {
                display: true,
                color: "#fff",
                font: { weight: "bold", size: 16 },
                formatter: (v) => (v > 0 ? v : ""),
              },
            },
            cutout: "70%",
          },
          plugins: [ChartDataLabels],
        });

        if (cD) {
          cD.destroy();
          cD = null;
        }
        cD = new Chart(document.getElementById("chartDuration").getContext("2d"), {
          type: "bar",
          data: {
            labels: ["0-20天", "21-30天", "30天+"],
            datasets: [
              {
                label: "案件數",
                data: [s.b1, s.b2, s.b3],
                backgroundColor: "#0078d4",
                borderRadius: 4,
                barPercentage: 0.5,
              },
            ],
          },
          options: {
            maintainAspectRatio: false,
            layout: { padding: { top: 25 } },
            scales: {
              y: {
                beginAtZero: true,
                grid: { drawBorder: false },
                ticks: { stepSize: 1, precision: 0 },
                suggestedMax: Math.max(s.b1, s.b2, s.b3) + 1,
              },
              x: { grid: { display: false } },
            },
            plugins: {
              legend: { display: false },
              datalabels: {
                anchor: "end",
                align: "top",
                offset: 0,
                color: "#64748b",
                font: { weight: "bold", size: 13 },
              },
            },
          },
          plugins: [ChartDataLabels],
        });
      }
      function renderYearlyTable() {
        let t = [...new Set(ecnData.map((t) => ("未知" !== t.month ? t.month.substring(0, 4) : "")).filter((t) => t))].sort().reverse(),
          e = document.getElementById("ecnYearlyTableSelect");
        if (!e) return;
        let n = e.value;
        if (t.length > 0) {
          let s = t.some((t) => ![...e.options].map((t) => t.value).includes(t));
          (0 === e.options.length || s) && ((e.innerHTML = t.map((t) => `<option value="${t}">${t} 年</option>`).join("")), (e.value = n && t.includes(n) ? n : t[0]));
        }
        let a = e.value || (t.length > 0 ? t[0] : new Date().getFullYear().toString()),
          r = [...new Set(ecnData.map((t) => t.month))]
            .filter((t) => t.startsWith(a))
            .sort()
            .reverse(),
          o = document.querySelector("#yearlyTable tbody");
        if (o) {
          if (0 === r.length) o.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-gray-400">該年度尚無數據</td></tr>`;
          else {
            let l = ecnData.filter((t) => t.month.startsWith(a)),
              d = getStats(l),
              p = (t, e) => (t > 0 ? `<span class="font-normal text-[10px] text-gray-600 pct">${e}%</span>` : '<span class="pct"></span>');
            ((o.innerHTML = r
              .map((t) => {
                let e = getStats(ecnData.filter((e) => e.month === t));
                return `<tr class="font-bold transition-colors hover:bg-gray-50">
                           <td class="p-3 pl-6 text-left text-gray-600 border-b">${DateUtils.formatMonthDisplay(t)}</td>
                           <td class="p-2 border-b">${e.total}</td>
                           <td class="p-2 text-emerald-600 border-b"><span>${e.closedCount}</span>${p(e.closedCount, e.closedPct)}</td>
                           <td class="p-2 text-blue-600 border-b"><span>${e.totalOngoing}</span>${p(e.totalOngoing, e.onPct)}</td>
                           <td class="p-2 text-red-600 border-b"><span>${e.voidCount}</span>${p(e.voidCount, e.voidPct)}</td>
                           <td class="p-2 text-green-600 border-b"><span>${e.b1}</span>${p(e.b1, e.p1)}</td>
                           <td class="p-2 text-amber-600 border-b"><span>${e.b2}</span>${p(e.b2, e.p2)}</td>
                           <td class="p-2 text-orange-600 border-b"><span>${e.b3}</span>${p(e.b3, e.p3)}</td></tr>`;
              })
              .join("")),
              (o.innerHTML += `<tr class="font-bold bg-gray-100">
                          <td class="p-3 pl-6 text-left text-gray-700 border-b">年度合計</td>
                          <td class="p-2 border-b">${d.total}</td>
                          <td class="p-2 text-emerald-600 border-b"><span>${d.closedCount}</span>${p(d.closedCount, d.closedPct)}</td>
                          <td class="p-2 text-blue-600 border-b"><span>${d.totalOngoing}</span>${p(d.totalOngoing, d.onPct)}</td>
                          <td class="p-2 text-red-600 border-b"><span>${d.voidCount}</span>${p(d.voidCount, d.voidPct)}</td>
                          <td class="p-2 text-green-600 border-b"><span>${d.b1}</span>${p(d.b1, d.p1)}</td>
                          <td class="p-2 text-amber-600 border-b"><span>${d.b2}</span>${p(d.b2, d.p2)}</td>
                          <td class="p-2 text-orange-600 border-b"><span>${d.b3}</span>${p(d.b3, d.p3)}</td>
                          </tr>`));
          }
        }
      }
      function updateMonthSelect() {
        let e = [...new Set(ecnData.map((e) => e.month))]
          .filter((e) => "未知" !== e)
          .sort()
          .reverse();
        ((document.getElementById("monthSelect").innerHTML = e.map((e) => `<option value="${e}">${e} 月</option>`).join("")), e.length && renderCharts());
      }

      /* 轉單功能 */
      function renderTransferPage() {
        (SyncTimeModule.update("fileTime_p10", 10), renderTransferSidebar(), renderTransferTable());
      }
      function renderTransferSidebar() {
        let e = (transferData || []).filter((e) => (e.type || "ECN") === currentTransferType);
        renderGenericSidebar(e, "approveDate", "transferYearSelect", "transferSidebarBody");
      }
      function renderTransferTable(e = null) {
        let t = document.getElementById("transferBody");
        if (!t) return;
        let a = document.getElementById("transferYearSelect")?.value,
          r = document.getElementById("searchBox_p10")?.value || "",
          o = (transferData || []).map((e, t) => ({ ...e, _idx: t })).filter((e) => (e.type || "ECN") === currentTransferType),
          s = SearchModule.filterData(o, "p10", r, !1, (t) => (null !== e && t._idx === e) || a === "ALL" || !t.approveDate || DateUtils.normalizeYear(t.approveDate) === a);
        (paginationState.p10 || (paginationState.p10 = 1), renderPaginationControls("pagination_p10", "p10", s.length, "renderTransferTable"));
        let d = getPaginatedData(s, "p10"),
          { ro: roAttr, txtCls } = Utils.authAttrs(),
          y = "p-2 border-b align-top",
          z = "p-2 border-b align-top text-center",
          txtFull = txtCls + " break-words whitespace-pre-wrap";
        ((t.innerHTML = d
          .map((t) => {
            let a = t._idx,
              r = DateUtils.calcWorkDays(t.arriveDate, t.approveDate),
              o = "ECR" === currentTransferType ? "【七】協辦單位(結案資訊)" : "【二】協辦單位(變更完成資訊)";
            return `<tr class="hover:bg-gray-50 group ${t._dirty ? "row-dirty" : ""} ${null !== e && a === e ? "highlight-row" : ""}" data-idx="${a}">
                      <td class="${y} sticky-col-cell"><span class="block py-0.5 font-bold text-ms-blue text-center text-xs">${Utils.escapeHtml(t.formId)}</span></td>
                      <td class="${y}"><span class="block py-0.5 text-xs">${Utils.escapeHtml(t.dept)}</span></td>
                      <td class="${y}"><span class="block py-0.5 text-xs">${Utils.escapeHtml(t.applicant)}</span></td>
                      <td class="${y}"><span class="block py-0.5 font-medium text-xs text-gray-600 truncate" title="${t.step || o}">${t.step || o}</span></td>
                      <td class="${z} text-xs">${DateUtils.formatDisplay(t.arriveDate) || '-'}</td>
                      <td class="${y}"><span class="block py-0.5 text-xs break-words whitespace-pre-wrap">${Utils.escapeHtml(t.result)}</span></td>
                      <td class="${z} text-xs">${DateUtils.formatDisplay(t.approveDate) || '-'}</td>
                      <td class="${z} bg-blue-50 border-blue-700/10 font-bold text-ms-blue">${r}</td>
                      <td class="${y}"><span class="block py-0.5 text-xs">${Utils.escapeHtml(t.executor)}</span></td>
                      <td class="${y}"><textarea rows="1" class="${txtFull}" style="min-height:24px" placeholder="" readonly oninput="Utils.autoResize(this)">${Utils.escapeHtml(t.comment)}</textarea></td></tr>`;
          })
          .join("")),
          setTimeout(() => {
            if ((t.querySelectorAll("textarea").forEach((e) => Utils.autoResize(e)), null !== e)) {
              let a = t.querySelector(".highlight-row");
              a && a.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }, 0),
          updateAuthUI());
      }
      function updateTransferRow(e, a, r) {
        const row = transferData[e];
        if (row) row[a] = r;
        renderTransferSidebar();
        renderTransferTable();
      }
      function switchTransferType(e) {
        let r = document.getElementById("searchBox_p10");
        (r && (r.value = ""), (currentTransferType = e), (paginationState.p10 = 1), (document.getElementById("btnTransECN").className = "ECN" === e ? "btn-primary px-4 py-2 text-sm shadow-inner rounded-l-md" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50 px-4 py-2 text-sm rounded-l-md"), (document.getElementById("btnTransECR").className = "ECR" === e ? "btn-primary px-4 py-2 text-sm shadow-inner rounded-r-md" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50 px-4 py-2 text-sm rounded-r-md"), renderTransferPage());
      }

      // ==========================================
      // 10. 板階模組 (Page 4, 5, 6)
      // ==========================================

      /* 板階統計報告 */
      function renderBoardCharts() {
        let t = [...boardData.newBoard.map((t) => t.applyDate), ...boardData.maintain.map((t) => t.date)].filter((t) => t),
          e = [...new Set(t.map((t) => DateUtils.normalizeYear(t)).filter((t) => t))].sort().reverse(),
          a = Utils.initYearSelect("boardYearSelect", e, "年", false),
          r = {},
          l = 0,
          d = 0,
          o = 0,
          n = 0,
          s = 0,
          i = {},
          $ = getActiveMaintainers();
        $.forEach((t) => {
          i[t] = { newBoard: 0, maintain: 0 };
        });
        let p = (t) => (t && $.find((e) => t.includes(e))) || null;
        (boardData.newBoard.forEach((t) => {
          const isCancelled = t.createDate === "取消";
          const initMonth = (m) => { r[m] || (r[m] = { applied: 0, completed: 0, maintain: 0, totalDays: 0, dayCount: 0 }); };
          if (t.applyDate && t.applyDate.startsWith(a)) {
            let e = DateUtils.normalizeMonth(t.applyDate);
            if (e) { initMonth(e); r[e].applied++; l++; }
          }
          if (t.createDate && !isCancelled && t.createDate.startsWith(a)) {
            let e = DateUtils.normalizeMonth(t.createDate);
            if (e) {
              initMonth(e);
              r[e].completed++; d++;
              let o = p(t.creator);
              if (o) i[o].newBoard++;
              let $ = DateUtils.calcWorkDays(t.updateDate || t.applyDate, t.createDate);
              "number" == typeof $ && ((r[e].totalDays += $), r[e].dayCount++, (n += $), s++);
            }
          }
        }),
          boardData.maintain.forEach((t) => {
            if (!t.date || !t.date.startsWith(a)) return;
            let e = DateUtils.normalizeMonth(t.date);
            if (!e) return;
            (r[e] ||
              (r[e] = {
                applied: 0,
                completed: 0,
                maintain: 0,
                totalDays: 0,
                dayCount: 0,
              }),
              r[e].maintain++,
              o++);
            let l = p(t.maintainer);
            l && i[l].maintain++;
          }));
        let b = Object.keys(r).sort().reverse(),
          c = s > 0 ? (n / s).toFixed(1) : 0;
        renderKPICards("boardKpiCards", [
          { label: "年度收件", val: l, color: "bg-blue-500" },
          { label: "年度新建", val: d, color: "bg-green-500" },
          { label: "平均天數", val: c, unit: "天", color: "bg-amber-500" },
          { label: "年度維護", val: o, color: "bg-purple-500" },
        ]);
        let g = document.getElementById("boardMonthlyTableBody");
        if (g) {
          if (b.length) {
            g.innerHTML = b
              .map((t) => {
                let e = r[t],
                  a = e.dayCount > 0 ? (e.totalDays / e.dayCount).toFixed(1) : "-",
                  l = e.completed + e.maintain;
                return `<tr class="transition-colors hover:bg-gray-50">
                      <td class="p-3 pl-6 font-bold text-left text-gray-600 border-b">${DateUtils.formatMonthDisplay(t)}</td>
                      <td class="p-3 font-bold text-blue-600 border-b">${e.applied || 0}</td>
                      <td class="p-3 font-bold text-green-600 border-b">${e.completed || 0}</td>
                      <td class="p-3 font-bold text-amber-600 border-b">${a}</td>
                      <td class="p-3 font-bold text-purple-600 border-b">${e.maintain || 0}</td>
                      <td class="p-3 font-bold text-gray-700 bg-gray-50 border-b">${l}</td></tr>`;
              })
              .join("");
            let m = d + o;
            g.innerHTML += `<tr class="font-bold bg-gray-100">
                      <td class="p-3 pl-6 text-left text-gray-700 border-b">年度合計</td>
                      <td class="p-3 text-blue-600 border-b">${l}</td>
                      <td class="p-3 text-green-600 border-b">${d}</td>
                      <td class="p-3 text-amber-600 border-b">${c}</td>
                      <td class="p-3 text-purple-600 border-b">${o}</td>
                      <td class="p-3 text-gray-700 bg-gray-200 border-b">${m}</td>
                      </tr>`;
          } else g.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-400">該年度無數據</td></tr>`;
        }
        let y = document.getElementById("boardStatsGrid");
        if (y) {
          let f = $.length <= 2 ? "grid-cols-1 md:grid-cols-2" : 3 === $.length ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-4";
          ((y.className = `grid ${f} gap-4`),
            (y.innerHTML = $.map((t) => {
              let e = i[t];
              return `<div class="p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
                          <div class="flex items-center mb-3 pb-2 border-b border-gray-100">
                          <h5 class="font-bold text-gray-700">👤 ${t}</h5></div>
                          <div class="grid gap-2 grid-cols-2 text-xs">
                          <div class="flex items-center gap-2 p-2 rounded ${e.newBoard > 0 ? "bg-gray-50" : "opacity-40"}">
                          <div class="w-2 h-2 bg-green-500 rounded-full"></div>
                          <span class="text-gray-500">新建</span>
                          <span class="ml-auto font-bold text-green-600">${e.newBoard}</span></div>
                          <div class="flex items-center gap-2 p-2 rounded ${e.maintain > 0 ? "bg-gray-50" : "opacity-40"}">
                          <div class="w-2 h-2 bg-purple-500 rounded-full"></div>
                          <span class="text-gray-500">維護</span>
                          <span class="ml-auto font-bold text-purple-600">${e.maintain}</span></div></div></div>`;
            }).join("")));
        }
      }

      /* 新建板階清單 */
      function renderNewBoardPage(e = null) {
        (renderFileTimeLabel("fileTime_p5", 5), renderNewBoardSidebar(), renderNewBoardTable(e));
      }
      function getNewBoardSortDate(record) {
        if (record.createDate === "取消") {
          return record.updateDate || record.applyDate || "";
        }
        return record.createDate || "";
      }

      YearlyModule.getDateFns.board_new = getNewBoardSortDate;

      function renderNewBoardSidebar() {
        renderGenericSidebar(boardData.newBoard, "createDate", "yearSelect_p5", "newBoardSidebarBody");
      }
      function renderNewBoardTable(e = null) {
        let t = document.getElementById("newBoardBody"),
          a = [...new Set(boardData.newBoard.map((e) => DateUtils.normalizeYear(getNewBoardSortDate(e))).filter((e) => e))].sort().reverse();
        Utils.initYearSelect("yearSelect_p5", a, "年", !0);
        let r = document.getElementById("yearSelect_p5")?.value,
          searchKw = document.getElementById("searchBox_p5")?.value || "";
        let raw = boardData.newBoard.map((item, idx) => {
          const isCancelled = item.createDate === "取消";
          const workDays = isCancelled ? "-" : DateUtils.calcWorkDays(item.updateDate || item.applyDate, item.createDate);
          const limit = OverdueModule.getThresholdPage5(item.priority);
          const isOverdue = !isCancelled && limit && typeof workDays === "number" && workDays > limit;
          return {
            ...item,
            _origIdx: idx,
            _workDays: workDays,
            _stage: getStageFromPartNo(item.partNo),
            _isOverdue: isOverdue ? "逾期" : (isCancelled ? "取消" : "")
          };
        });
        let l = SearchModule.filterData(raw, "p5", searchKw, !1, (e) => {
          if (!r || r === "ALL") return true;
          const sortDate = getNewBoardSortDate(e);
          return !sortDate || DateUtils.normalizeYear(sortDate) === r;
        });
        let o = boardSortConfig.p5;
        o.key && Utils.sortData(l, o.key, o.asc);
        renderPaginationControls("pagination_p5", "p5", l.length, "renderNewBoardTable");
        let n = getPaginatedData(l, "p5"),
          { ro: roAttr, dis: disAttr, inputCls, txtCls } = Utils.authAttrs(),
          inputFull = inputCls + " w-full",
          y = "p-2 border-b align-top",
          z = "p-2 border-b align-top text-center",
          txtFull = txtCls + " break-words whitespace-pre-wrap";
        t.innerHTML = n
          .map((t) => {
            let a = t._origIdx,
              r = generateDynamicOptions("board_applicant", t.applicant);
            const isCancelled = t.createDate === "取消";
            let workDays = isCancelled ? "-" : DateUtils.calcWorkDays(t.updateDate || t.applyDate, t.createDate);
            return `<tr class="hover:bg-gray-50 group ${t._dirty ? "row-dirty" : ""} ${null !== e && a === e ? "highlight-row" : ""}">
                  <td class="${z} auth-only"><button class="mt-1 text-gray-400 opacity-0 hover:text-red-600 group-hover:opacity-100" onclick="deleteGeneralRow('newBoard', ${a})"><i class="fa-solid fa-trash-can"></i></button></td>
                  <td class="${z}"><input type="text" value="${DateUtils.formatDisplay(t.applyDate)}" class="${inputFull} flatpickr-board text-center" ${roAttr} data-idx="${a}" data-table="newBoard" data-field="applyDate" placeholder="選擇日期"></td>
                  <td class="${z}"><input type="text" class="${inputFull} flatpickr-board text-center" value="${DateUtils.formatDisplay(t.updateDate)}" ${roAttr} data-idx="${a}" data-table="newBoard" data-field="updateDate" placeholder="-"></td>
                  <td class="${z}"><input type="text" class="${inputFull} flatpickr-board-done text-center${CancelInputModule.cancelClass(t.createDate)}" value="${CancelInputModule.displayValue(t.createDate)}" ${roAttr} data-idx="${a}" data-table="newBoard" data-field="createDate" placeholder="選擇日期"></td>
                  <td class="${y}"><input type="text" class="${inputFull}" value="${Utils.escapeHtml(t.partNo)}" placeholder="料號" ${roAttr} onchange="updateBoardRow('newBoard',${a},'partNo',this.value)"></td>
                  <td class="${z}">${(() => { const stage = getStageFromPartNo(t.partNo); return stage ? `<span class="text-gray-700">${stage}</span>` : '<span class="text-gray-300">-</span>'; })()}</td>
                  <td class="${z}"><textarea rows="1" class="${txtFull} text-center" style="min-height:24px" placeholder="專案代碼" ${roAttr} oninput="Utils.autoResize(this)" onchange="updateBoardRow('newBoard',${a},'projectCode',this.value)">${Utils.escapeHtml(t.projectCode)}</textarea></td>
                  <td class="${z}"><select class="${inputFull}" style="text-align-last:center" ${disAttr} onchange="updateBoardRow('newBoard',${a},'applicant',this.value)">${r}</select></td>
                  <td class="${y}"><select class="${inputFull}" style="text-align-last:center" ${disAttr} onchange="updateBoardRow('newBoard',${a},'hasBOM',this.value)">
                  <option value="" ${t.hasBOM ? "" : "selected"}></option>
                  <option value="Y" ${"Y" === t.hasBOM ? "selected" : ""}>Y[有]</option>
                  <option value="N" ${"N" === t.hasBOM ? "selected" : ""}>N[無]</option></select></td>
                  <td class="${z}"><input type="text" value="${"N" === t.hasBOM ? "NA" : DateUtils.formatDisplay(t.bomDate)}" class="${inputFull} ${"N" === t.hasBOM ? "" : "flatpickr-board"} text-center" ${"N" === t.hasBOM ? "readonly" : roAttr} data-idx="${a}" data-table="newBoard" data-field="bomDate" placeholder="選擇日期"></td>
                  <td class="${y}"><select class="${inputFull}" style="text-align-last:center" ${disAttr} onchange="updateBoardRow('newBoard',${a},'creator',this.value)">${generateMaintainerOptions(t.creator)}</select></td>
                  <td class="${y}"><select class="${inputFull}" style="text-align-last:center" ${disAttr} onchange="updateBoardRow('newBoard',${a},'priority',this.value)">
                  <option value="一般" ${"一般" === t.priority ? "selected" : ""}>一般</option>
                  <option value="急件" ${"急件" === t.priority ? "selected" : ""}>急件</option></select></td>
                  <td class="${z} bg-blue-50 border-blue-700/10 font-bold text-ms-blue">${ isCancelled ? '<span class="text-gray-400 select-none">-</span>' : (workDays === "-" ? '<i class="fa-solid fa-calendar-clock text-sm text-gray-300"></i>' : workDays)}</td>
                  <td class="${z} bg-red-50 border-red-700/10 font-bold">${(() => {
                    const limit = OverdueModule.getThresholdPage5(t.priority);
                    const isOverdue = limit && typeof workDays === "number" && workDays > limit;
                    return isOverdue ? `<span class="text-red-500">${workDays - limit}</span>` : '<span class="text-gray-300">-</span>';
                  })()}</td>
                  <td class="${y} bg-red-50 border-red-700/10">${(() => {
                    const isOverdue = OverdueModule.isOverduePage5(t.priority, workDays);
                    const hasUpdateDate = !!t.updateDate;
                    if (!isOverdue && !hasUpdateDate) return '<div style="min-height:24px"></div>';
                    return `<textarea rows="1" class="${txtFull}" style="min-height:24px;field-sizing:content" placeholder="說明" ${roAttr} oninput="Utils.autoResize(this)" onchange="updateBoardRow('newBoard',${a},'overdueNote',this.value)">${Utils.escapeHtml(t.overdueNote || "")}</textarea>`;
                  })()}</td>
                  </tr>`;
          })
          .join("");
        setTimeout(() => {
          t.querySelectorAll("textarea").forEach((e) => Utils.autoResize(e));
          if (null !== e) {
            let a = t.querySelector(".highlight-row");
            a && a.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 0);
        updateAuthUI();
        FlatpickrManager.init(".flatpickr-board", (e, t) => {
          updateBoardRow(e.dataset.table, parseInt(e.dataset.idx), e.dataset.field, t);
        });
        CancelInputModule.setup(".flatpickr-board-done", (e, t) => {
          updateBoardRow(e.dataset.table, parseInt(e.dataset.idx), e.dataset.field, t);
        });
      }
      function addNewBoardRow() {
        addGenericRow({
          dataArray: boardData.newBoard,
          defaultRow: {
            applyDate: "",
            updateDate: "",
            createDate: "",
            partNo: "",
            projectCode: "",
            applicant: "",
            hasBOM: "",
            bomDate: "",
            creator: "",
            priority: "一般",
            overdueNote: "",
          },
          paginationKey: "p5",
          renderFn: renderNewBoardPage,
          triggerPageId: 5,
          scrollSelector: "#page5 #newBoardScrollContainer .overflow-auto",
          dataType: "board_new",
        });
      }
      function updateBoardRow(e, a, d, r) {
        let t = "newBoard" === e;
        updateGenericRow({
          dataArray: t ? boardData.newBoard : boardData.maintain,
          index: a,
          field: d,
          value: r,
          yearSelectId: t ? "yearSelect_p5" : "yearSelect_p6",
          dateField: t ? "createDate" : "date",
          renderFn: (e) => (t ? renderNewBoardPage(e) : renderMaintainPage(e)),
          triggerPageId: t ? 5 : 6,
          dataType: t ? "board_new" : "board_maint",
        });
      }

      /* 板階維護清單 */
      function renderMaintainPage(n = null) {
        (renderFileTimeLabel("fileTime_p6", 6), renderMaintainSidebar(), renderMaintainTable(n));
      }
      function renderMaintainSidebar() {
        renderGenericSidebar(boardData.maintain, "date", "yearSelect_p6", "maintainSidebarBody");
      }
      function renderMaintainTable(t = null) {
        let a = document.getElementById("maintainBody"),
          e = [...new Set(boardData.maintain.map((t) => DateUtils.normalizeYear(t.date)).filter((t) => t))].sort().reverse();
        Utils.initYearSelect("yearSelect_p6", e, "年");
        let n = document.getElementById("yearSelect_p6")?.value,
          l = boardData.maintain.map((t, a) => ({ ...t, _origIdx: a }));
        n && n !== "ALL" && (l = l.filter((t) => !t.date || DateUtils.normalizeYear(t.date) === n));
        let i = boardSortConfig.p6;
        (i.key && Utils.sortData(l, i.key, i.asc), renderPaginationControls("pagination_p6", "p6", l.length, "renderMaintainTable"));
        let r = getPaginatedData(l, "p6"),
          { ro: roAttr, dis: disAttr, inputCls } = Utils.authAttrs(),
          y = "p-2 border-b align-top",
          z = "p-2 border-b align-top text-center",
          inputFull = inputCls + " w-full";
        ((a.innerHTML = r
          .map((a) => {
            let e = a._origIdx;
            return `<tr class="hover:bg-gray-50 group ${a._dirty ? "row-dirty" : ""} ${null !== t && e === t ? "highlight-row" : ""}">
                  <td class="${z} auth-only"><button class="mt-1 text-gray-400 opacity-0 hover:text-red-600 group-hover:opacity-100" onclick="deleteGeneralRow('boardMaintain', ${e})"><i class="fa-solid fa-trash-can"></i></button></td>
                  <td class="${z}"><input type="text" value="${DateUtils.formatDisplay(a.date)}" class="${inputFull} flatpickr-board-maintain text-center" ${roAttr} data-idx="${e}" placeholder="選擇日期"></td>
                  <td class="${y}"><input type="text" class="${inputFull}" value="${Utils.escapeHtml(a.partNo)}" placeholder="料號" ${roAttr} onchange="updateBoardRow('maintain',${e},'partNo',this.value)"></td>
                  <td class="${y}"><select class="${inputFull} w-full" ${disAttr} onchange="updateBoardRow('maintain',${e},'maintainer',this.value)">${generateMaintainerOptions(a.maintainer)}</select></td>
                  <td class="${y}"><input type="text" class="${inputFull}" value="${Utils.escapeHtml(a.note)}" placeholder="" ${roAttr} onchange="updateBoardRow('maintain',${e},'note',this.value)"></td></tr>`;
          })
          .join("")),
          updateAuthUI(),
          FlatpickrManager.init(".flatpickr-board-maintain", (t, a) => {
            updateBoardRow("maintain", parseInt(t.dataset.idx), "date", a);
          }));
      }
      function addMaintainRow() {
        addGenericRow({
          dataArray: boardData.maintain,
          defaultRow: { date: "", partNo: "", maintainer: "", note: "" },
          paginationKey: "p6",
          renderFn: renderMaintainPage,
          triggerPageId: 6,
          scrollSelector: "#page6 #maintainScrollContainer .overflow-auto",
          dataType: "board_maint",
        });
      }
      /* PAGE6 批次貼上 */
      const maintainPasteConfig = {
        columns: [
          { key: "date",   label: "日期",  col: 0, required: false, type: "date" },
          { key: "partNo", label: "料號",  col: 1, required: true },
          { key: "note",   label: "備註",  col: 2 },
        ],
        extraFields: [
          { key: "maintainer", label: "套用維護人", type: "select", options: () => getActiveMaintainers() },
        ],
        placeholder: "在此貼上從 Excel 複製的資料（Ctrl+V）\n\n欄位順序：A 日期 › B 料號 › C 備註（可省略）",
        afterParse(row) {
          row._dirty = true;
          row._isNew = true;
        },
        onConfirm(rows) {
          for (let i = rows.length - 1; i >= 0; i--) {
            const newRow = { ...rows[i] };
            boardData.maintain.unshift(newRow);
            YearlyModule.markDirtyFromRecord("board_maint", newRow);
          }
          paginationState["p6"] = 1;
          renderMaintainPage();
          updateSaveButtonStatus();
          setTimeout(() => {
            document.querySelector("#page6 #maintainScrollContainer .overflow-auto")?.scrollTo({ top: 0, behavior: "smooth" });
          }, 0);
          ToastModule.show(`已新增 ${rows.length} 筆資料，請記得儲存`, "success");
        },
      };

      function openMaintainPasteModal() {
        BatchPasteModule.open(maintainPasteConfig);
      }

      /* 板階排序 */
      function handleBoardSort(e, t) {
        let a = boardSortConfig[e];
        if ((a.key === t ? (a.asc = !a.asc) : ((a.key = t), (a.asc = !0)), "p5" === e ? renderNewBoardTable() : renderMaintainTable(), "p5" === e))
          ["applyDate", "createDate"].forEach((e) => {
            let t = document.getElementById(`sort_p5_${e}`);
            t && (t.innerHTML = Utils.getSortIcon(a.key === e, a.asc));
          });
        else {
          let n = document.getElementById("sort_p6_date");
          n && (n.innerHTML = Utils.getSortIcon("date" === a.key, a.asc));
        }
      }

      // ==========================================
      // 11. PCB 模組 (Page 3, 7, 8, 9)
      // ==========================================

      /* 擷取英文姓名（去除中文前綴），空值統一回傳 "" */
      function extractEngName(fullName) {
        if (!fullName) return "";
        const match = fullName.match(/[\u4e00-\u9fa5]+\s*(.+)/);
        return (match ? match[1] : fullName).trim();
      }

      /* PCB JSON 匯入 (Console 工具產出) */
      function handlePcbJsonImport(input) {
        const file = input.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const json = JSON.parse(e.target.result);
            let newData;
            if (Array.isArray(json)) newData = json;
            else if (json.rows) newData = json.rows;
            else { ToastModule.show('JSON 格式不正確', 'warning'); return; }

            const PRESERVE = ['updateDate1','note1','updateDate2','note2','needApprove'];
            const SIGN_FIELDS = ['name2','time2','isRejected2','name3','time3','isRejected3',
              'name7','time7','isRejected7','name8','time8','isRejected8',
              'name13','time13','isRejected13','name15','time15','isRejected15'];
            let p = new Map(pcbStore.list.map(e => [e.id, e]));
            let added = 0, updated = 0, unchanged = 0;
            const ns = v => (v || '').trim();
            const nb = v => !!v;

            for (const r of newData) {
              if (!r.id) continue;
              r.status = StatusModule.normalize(r.status);

              const ex = p.get(r.id);
              if (ex) {
                let merged = { ...ex }, changed = false;
                if (ns(ex.status) !== ns(r.status)) { merged.status = r.status; changed = true; }
                if (r.partNo && ns(ex.partNo) !== ns(r.partNo)) { merged.partNo = r.partNo; changed = true; }
                const rApplicant = r.applicant ? extractEngName(r.applicant) : '';
                if (rApplicant && ns(ex.applicant) !== ns(rApplicant)) { merged.applicant = rApplicant; changed = true; }
                if (r.priority && ns(ex.priority) !== ns(r.priority)) { merged.priority = r.priority; changed = true; }
                for (const f of SIGN_FIELDS) {
                  if (f.startsWith('isRejected')) {
                    if (nb(r[f]) !== nb(ex[f])) { merged[f] = r[f]; changed = true; }
                  } else if (f.startsWith('name')) {
                    const engName = r[f] ? extractEngName(r[f]) : '';
                    if (engName && ns(ex[f]) !== ns(engName)) { merged[f] = engName; changed = true; }
                  } else {
                    if (r[f] && ns(ex[f]) !== ns(r[f])) { merged[f] = r[f]; changed = true; }
                  }
                }
                if (changed) {
                  for (const f of PRESERVE) merged[f] = ex[f] || '';
                  const ck = (s, e) => { if (!s||!e) return '-'; return DateUtils.calcWorkDays(s, e); };
                  merged.kpi1 = merged.isRejected3 ? '-' : ck(merged.time2, merged.updateDate1||merged.time3);
                  merged.kpi2 = merged.isRejected8 ? '-' : ck(merged.time7, merged.updateDate2||merged.time8);
                  merged.kpi3 = merged.isRejected15 ? '-' : ck(merged.time13, merged.time15);
                  merged._dirty = true;
                  p.set(r.id, merged);
                  YearlyModule.markDirtyFromRecord('pcb_list', merged);
                  updated++;
                } else { unchanged++; }
              } else {
                const ck = (s, e) => { if (!s||!e) return '-'; return DateUtils.calcWorkDays(s, e); };
                r.kpi1 = r.isRejected3 ? '-' : ck(r.time2, r.time3);
                r.kpi2 = r.isRejected8 ? '-' : ck(r.time7, r.time8);
                r.kpi3 = r.isRejected15 ? '-' : ck(r.time13, r.time15);
                for (const f of PRESERVE) r[f] = r[f] || '';
                if (r.applicant) r.applicant = extractEngName(r.applicant);
                for (const f of SIGN_FIELDS) {
                  if (f.startsWith('name') && r[f]) r[f] = extractEngName(r[f]);
                }
                r._dirty = true;
                p.set(r.id, r);
                YearlyModule.markDirtyFromRecord('pcb_list', r);
                added++;
              }
            }
            pcbStore.list = Array.from(p.values()).sort((a, b) => (b.id || '').localeCompare(a.id || ''));
            trimInputsOnly(pcbStore.list);
            (added > 0 || updated > 0) && triggerChange(3);
            renderPCBKPITable();
            ToastModule.show(`PCB 匯入完成：新增 ${added}、更新 ${updated}`, added > 0 || updated > 0 ? 'success' : 'info');
          } catch (err) { console.error(err); ToastModule.show('PCB JSON 解析失敗: ' + err.message, 'error'); }
        };
        reader.readAsText(file); input.value = '';
      }

      /* PCB 年份判斷 */
      function getPCBRowYear(i) {
        if (!i) return "";
        if (i.time3) return i.time3.substring(0, 4);
        if (i.time2) return i.time2.substring(0, 4);
        if (i.id && i.id.includes("-")) {
          let n = i.id.split("-");
          if (n[1] && n[1].length >= 4) return n[1].substring(0, 4);
        }
        return "";
      }

      /* PCB 詳細清單 */
      function renderPCBKPITable(e = null) {
        SyncTimeModule.update("fileTime_p3", 3);
        Utils.sortData(pcbStore.list, pcbSortConfig.key, pcbSortConfig.asc);
        let t = document.getElementById("pcbBody"),
          r = document.getElementById("pcbListYearSelect");
        if (!t) return;
        let searchKw = document.getElementById("searchBox_p3")?.value || "";
        let a = [...new Set(pcbStore.list.map((e) => getPCBRowYear(e)))]
          .filter((e) => e)
          .sort()
          .reverse();
        Utils.initYearSelect("pcbListYearSelect", a, "年", !0);
        let d = r.value;
        let rawList = pcbStore.list.map((item, idx) => {
          const od1 = OverdueModule.getOverdueDaysPage3(item.kpi1, item.isRejected3);
          const od2 = OverdueModule.getOverdueDaysPage3(item.kpi2, item.isRejected8);
          const overdue1 = od1 !== null ? String(od1) : "";
          const overdue2 = od2 !== null ? String(od2) : "";
          const hasOverdue = overdue1 || overdue2;
          return {
            ...item,
            _origIdx: idx,
            _search_approve: item.needApprove || "",
            _overdue1: overdue1,
            _overdue2: overdue2,
            _isOverdue: hasOverdue ? "逾期" : "",
            _allNotes: [item.note1 || "", item.note2 || ""].filter(n => n).join(" "),
          };
        });
        let n = SearchModule.filterData(rawList, "p3", searchKw, !1, (item) => {
          let rowYear = getPCBRowYear(item);
          return (null !== e && item._origIdx === e) || d === "ALL" || !rowYear || rowYear === d;
        });
        if (!n.length) {
          t.innerHTML = '<tr><td colspan="27" class="p-8 text-center text-gray-400">查無資料</td></tr>';
          document.getElementById("pagination_p3").innerHTML = "";
          return;
        }
        renderPaginationControls("pagination_p3", "p3", n.length, "renderPCBKPITable");
        let paged = getPaginatedData(n, "p3");
        let { ro: roAttr, dis: disAttr, inputCls, txtCls } = Utils.authAttrs(),
          inputFull = inputCls + " w-full",
          y = "p-2 border-b align-top",
          z = "p-2 border-b align-top text-center",
          i = isLoggedIn ? "table-input w-full font-bold text-amber-700" : "table-input w-full font-bold !text-amber-700 bg-transparent border-none appearance-none";
        t.innerHTML = paged
          .map((t) => {
            let r = t._origIdx;
            let isVoid = StatusModule.isVoid(t.status);
            const GD = '<span class="font-bold text-gray-300 select-none">-</span>';
            const renderDateCell = (field, val) => {
              if (!val) return '<span class="font-bold text-gray-300 select-none">-</span>';
              const num = field.replace("time", "");
              const isRejected = t["isRejected" + num];
              const display = DateUtils.formatDisplay(val);
              if (isRejected) return display + '<span class="ml-0.5 font-bold text-[10px] text-red-500 tracking-tighter">(駁)</span>';
              return display;
            };
            const overdue1 = OverdueModule.getOverdueDaysPage3(t.kpi1, t.isRejected3);
            const overdue2 = OverdueModule.getOverdueDaysPage3(t.kpi2, t.isRejected8);
            const canEditNote1 = !!t.updateDate1 || overdue1 !== null;
            const canEditNote2 = !!t.updateDate2 || overdue2 !== null;
            const renderNoteCell = (noteField, noteValue, canEdit) => {
              if (!canEdit && !noteValue) return '<div style="min-height:24px"></div>';
              return `<textarea rows="1" class="${txtCls} break-words whitespace-pre-wrap" style="min-height:24px;field-sizing:content" placeholder="說明" ${roAttr} oninput="Utils.autoResize(this)" onchange="updatePCBRow(${r},'${noteField}',this.value)">${Utils.escapeHtml(noteValue || "")}</textarea>`;
            };
            return `<tr class="hover:bg-gray-50 transition-colors group ${t._dirty ? "row-dirty" : ""} ${null !== e && r === e ? "highlight-row" : ""}" data-idx="${r}">
                  <td class="${y} sticky-col-cell sticky-no-shadow font-bold text-ms-blue">${Utils.escapeHtml(t.id)}</td>
                  <td class="${y} sticky-col-cell" style="left: 150px;">${t.partNo ? Utils.escapeHtml(t.partNo) : '<span class="text-gray-300">-</span>'}</td>
                  <td class="${z}"><span class="${getBadgeClass(t.status)}">${t.status || "進行中"}</span></td>
                  <td class="${z}">${t.applicant || GD}</td>
                  <td class="${z}">${isVoid && !t.priority ? GD : (t.priority || "")}</td>
                  <td class="${z}">${t.name2 ? Utils.escapeHtml(t.name2) : GD}</td>
                  <td class="${z} px-0.5">${renderDateCell("time2", t.time2)}</td>
                  <td class="${z}">${t.name3 ? Utils.escapeHtml(t.name3) : GD}</td>
                  <td class="${z} px-0.5">${renderDateCell("time3", t.time3)}</td>
                  <td class="${z}">${isVoid && !t.updateDate1 
                  ? '<span class="font-bold text-gray-300 select-none">-</span>' 
                  : `<input type="text" value="${DateUtils.formatDisplay(t.updateDate1)}" class="${inputFull} flatpickr-pcb text-center" ${roAttr} data-idx="${r}" data-field="updateDate1" placeholder="-">`}</td>
                  <td class="${z} bg-blue-50 border-blue-700/10 font-bold text-ms-blue">${typeof t.kpi1 === "number" ? t.kpi1 : "-"}</td>
                  <td class="${z} bg-red-50 border-red-700/10 font-bold">${overdue1 !== null ? `<span class="text-red-500">${overdue1}</span>` : '<span class="text-gray-300">-</span>'}</td>
                  <td class="${y} bg-red-50 border-red-700/10">${renderNoteCell("note1", t.note1, canEditNote1)}</td>
                  <td class="${z}">${t.name7 ? Utils.escapeHtml(t.name7) : GD}</td>
                  <td class="${z} px-0.5">${renderDateCell("time7", t.time7)}</td>
                  <td class="${z}">${t.name8 ? Utils.escapeHtml(t.name8) : GD}</td>
                  <td class="${z} px-0.5">${renderDateCell("time8", t.time8)}</td>
                  <td class="${z}">${isVoid && !t.updateDate2 
                  ? '<span class="font-bold text-gray-300 select-none">-</span>' 
                  : `<input type="text" value="${DateUtils.formatDisplay(t.updateDate2)}" class="${inputFull} flatpickr-pcb text-center" ${roAttr} data-idx="${r}" data-field="updateDate2" placeholder="-">`}</td>
                  <td class="${z} bg-blue-50 border-blue-700/10 font-bold text-ms-blue">${typeof t.kpi2 === "number" ? t.kpi2 : "-"}</td>
                  <td class="${z} bg-red-50 border-red-700/10 font-bold">${overdue2 !== null ? `<span class="text-red-500">${overdue2}</span>` : '<span class="text-gray-300">-</span>'}</td>
                  <td class="${y} bg-red-50 border-red-700/10">${renderNoteCell("note2", t.note2, canEditNote2)}</td>
                  <td class="${z} bg-yellow-50 border-yellow-700/10"><span class="font-bold text-amber-700">${
                    t.needApprove ? Utils.escapeHtml(t.needApprove) : '<span class="text-gray-300">-</span>'
                  }</span></td>
                  <td class="${z}">${t.name13 ? Utils.escapeHtml(t.name13) : GD}</td>
                  <td class="${z} px-0.5">${renderDateCell("time13", t.time13)}</td>
                  <td class="${z}">${t.name15 ? Utils.escapeHtml(t.name15) : GD}</td>
                  <td class="${z} px-0.5">${renderDateCell("time15", t.time15)}</td>
                  <td class="${z} bg-blue-50 border-blue-700/10 font-bold text-ms-blue">${typeof t.kpi3 === "number" ? t.kpi3 : "-"}</td></tr>`;
          })
          .join("");
        setTimeout(() => {
          if (null !== e) {
            let r = t.querySelector(".highlight-row");
            r && r.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 100);
        updateAuthUI();
        FlatpickrManager.init(".flatpickr-pcb", (e, t) => {
          let r = parseInt(e.dataset.idx),
            a = e.dataset.field;
          updatePCBRow(r, a, t);
        });

        // P3 表頭拖曳初始化
        const p3Thead = document.querySelector("#page3 table thead tr");
        if (p3Thead) {
          ColumnOrderModule.initDraggable("#page3 table", "p3", () => renderPCBKPITable());
          reorderP3TableBody();
        }
      }
      function reorderP3TableBody() {
        const order = ColumnOrderModule.getOrder("p3"),
          colIds = ["pcbId", "partNo", "status", "applicant", "priority", "name2", "time2", "name3", "time3", "updateDate1", "kpi1", "overdue1", "note1", "name7", "time7", "name8", "time8", "updateDate2", "kpi2", "overdue2", "note2", "needApprove", "name13", "time13", "name15", "time15", "kpi3"];
        const tbody = document.getElementById("pcbBody");
        if (!tbody || !order.length) return;
        ColumnOrderModule.applyColgroupOrder("#page3 table", "p3");
        tbody.querySelectorAll("tr").forEach((row) => {
          const tds = Array.from(row.children);
          order.forEach((id) => {
            const idx = colIds.indexOf(id);
            if (idx >= 0 && tds[idx]) row.appendChild(tds[idx]);
          });
        });
      }

      function updatePCBRow(e, t, i) {
        let r = pcbStore.list[e];
        if (r) {
            if ("id" === t && "" !== i && pcbStore.list.some((o, n) => n !== e && o.id === i)) return (ToastModule.show(`單號 ${i} 重複`, "error"), (r.id = ""), void renderPCBKPITable(null));
            if (t === "time3" || t === "time2") {
                let _oldY = YearlyModule.getYear(r, "time3") || String(new Date().getFullYear());
                YearlyModule.markDirty("pcb_list", _oldY);
            }
            r[t] = i;
            
            const timeFields = ["time2", "time3", "time7", "time8", "time13", "time15"];
            if (timeFields.includes(t)) {
              const rejKey = "isRejected" + t.replace("time", "");
              if (r[rejKey]) {
                r[rejKey] = false;
              }
            }
            
          let s = (e, t) => {
              if (!e || !t) return "-";
              return DateUtils.calcWorkDays(e, t);
            };
          r.kpi1 = r.isRejected3 ? "-" : s(r.updateDate1 || r.time2, r.time3);
          r.kpi2 = r.isRejected8 ? "-" : s(r.updateDate2 || r.time7, r.time8);
          r.kpi3 = r.isRejected15 ? "-" : s(r.time13, r.time15);

          if (OverlayModule.PCB_FIELDS.includes(t)) {
            const o = OverlayModule.extractPcbFields(r);
            if (OverlayModule.hasPcbContent(o)) OverlayModule.pcb.set(r.id, o);
            else OverlayModule.pcb.delete(r.id);
          }
          
          let l = getPCBRowYear(r),
            a = document.getElementById("pcbListYearSelect"),
            o = a ? a.value : null,
            needHighlight = false;
          if (l && a && "ALL" !== o && o !== l) {
            let s = [...a.options].some((e) => e.value === l);
            if (!s) {
              let c = document.createElement("option");
              ((c.value = l), (c.text = l + " 年"));
              let u = !1;
              for (let d = 0; d < a.options.length; d++)
                if ("ALL" !== a.options[d].value && a.options[d].value < l) {
                  (a.add(c, d), (u = !0));
                  break;
                }
              u || a.add(c);
            }
            ((a.value = l), ToastModule.show(`已切換至 ${l} 年`, "info"));
            needHighlight = true;
          }
          (triggerChange(3, r, "pcb_list"), renderPCBKPITable(needHighlight ? e : null));
        }
      }
      function sortPCBList(t) {
        (pcbSortConfig.key === t ? (pcbSortConfig.asc = !pcbSortConfig.asc) : ((pcbSortConfig.key = t), (pcbSortConfig.asc = !0)), Utils.sortData(pcbStore.list, pcbSortConfig.key, pcbSortConfig.asc), renderPCBKPITable());
        let s = document.getElementById("sort_pcb_id");
        s && (s.innerHTML = Utils.getSortIcon(!0, pcbSortConfig.asc));
      }

      /* PCB 統計報告 */
      function renderPCBReport() {
        let t = {},
          e = [],
          l = (t) => {
            t && e.push(t);
          };
        (pcbStore.list.forEach((t) => {
          (l(t.time3), l(t.time8), l(t.time13), l(t.time15));
        }),
          pcbStore.gpms.forEach((t) => l(t.date)),
          (pcbStore.maintain || []).forEach((t) => l(t.date)));
        let r = [...new Set(e.map((t) => DateUtils.normalizeYear(t)).filter((t) => t))].sort().reverse();
        Utils.initYearSelect("pcbYearSelect", r, "年", false);
        let a = document.getElementById("pcbYearSelect")?.value || r[0] || new Date().getFullYear().toString(),
          c = { c3: 0, c8: 0, c13: 0, c15: 0, gpms: 0, mt: 0 },
          d = {},
          $ = getActiveMaintainers();
        $.forEach((t) => {
          d[t] = { c3: 0, c8: 0, c13: 0, c15: 0, gpms: 0, mt: 0 };
        });
        let o = (t) => (t && getActiveMaintainers().find((e) => t.includes(e))) || null,
          s = (e, l, r) => {
            if (e && e.startsWith(a)) {
              let $ = DateUtils.normalizeMonth(e);
              (t[$] || (t[$] = { c3: 0, c8: 0, c13: 0, c15: 0, gpms: 0, mt: 0 }), t[$][l]++, c[l]++);
              let s = o(r);
              s && d[s][l]++;
            }
          };
        (pcbStore.list.forEach((t) => {
          (s(t.time3, "c3", t.name3), s(t.time8, "c8", t.name8), s(t.time13, "c13", t.name13), s(t.time15, "c15", t.name15));
        }),
          pcbStore.gpms.forEach((t) => s(t.date, "gpms", t.maintainer)),
          (pcbStore.maintain || []).forEach((t) => s(t.date, "mt", t.maintainer)));
        let b = Object.keys(t).sort().reverse();
        renderKPICards("pcbKpiCards", [
          { label: "PCB 新建", val: c.c3, color: "bg-blue-500" },
          { label: "PCB 定版", val: c.c8, color: "bg-emerald-500" },
          { label: "製作承認書", val: c.c13, color: "bg-amber-500" },
          { label: "歸檔承認書", val: c.c15, color: "bg-purple-500" },
          { label: "GPMS 啟動", val: c.gpms, color: "bg-cyan-500" },
          { label: "PCB 維護", val: c.mt, color: "bg-rose-500" },
        ]);
        let n = document.getElementById("pcbReportBody");
        if (n) {
          if (b.length) {
            n.innerHTML = b
              .map((e) => {
                let l = t[e],
                  r = l.c3 + l.c8 + l.c13 + l.c15 + l.gpms + l.mt;
                return `<tr class="transition-colors hover:bg-gray-50">
                  <td class="p-3 pl-6 font-bold text-left text-gray-600 border-b">${DateUtils.formatMonthDisplay(e)}</td>
                  <td class="p-3 font-bold text-blue-600 border-b">${l.c3 || 0}</td>
                  <td class="p-3 font-bold text-emerald-600 border-b">${l.c8 || 0}</td>
                  <td class="p-3 font-bold text-amber-600 border-b">${l.c13 || 0}</td>
                  <td class="p-3 font-bold text-purple-600 border-b">${l.c15 || 0}</td>
                  <td class="p-3 font-bold text-cyan-600 border-b">${l.gpms || 0}</td>
                  <td class="p-3 font-bold text-rose-600 border-b">${l.mt || 0}</td>
                  <td class="p-3 font-bold text-gray-700 bg-gray-50 border-b">${r}</td></tr>`;
              })
              .join("");
            let g = c.c3 + c.c8 + c.c13 + c.c15 + c.gpms + c.mt;
            n.innerHTML += `<tr class="font-bold bg-gray-100">
                  <td class="p-3 pl-6 text-left text-gray-700 border-b">年度合計</td>
                  <td class="p-3 text-blue-600 border-b">${c.c3}</td>
                  <td class="p-3 text-emerald-600 border-b">${c.c8}</td>
                  <td class="p-3 text-amber-600 border-b">${c.c13}</td>
                  <td class="p-3 text-purple-600 border-b">${c.c15}</td>
                  <td class="p-3 text-cyan-600 border-b">${c.gpms}</td>
                  <td class="p-3 text-rose-600 border-b">${c.mt}</td>
                  <td class="p-3 text-gray-700 bg-gray-200 border-b">${g}</td></tr>`;
          } else n.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-gray-400">該年度無數據</td></tr>`;
        }
        let p = document.getElementById("pcbPersonStats");
        if (p) {
          let i = [
              {
                key: "c3",
                label: "PCB 新建",
                color: "bg-blue-500",
                text: "text-blue-600",
              },
              {
                key: "c8",
                label: "PCB 定版",
                color: "bg-emerald-500",
                text: "text-emerald-600",
              },
              {
                key: "c13",
                label: "製作承認書",
                color: "bg-amber-500",
                text: "text-amber-600",
              },
              {
                key: "c15",
                label: "歸檔承認書",
                color: "bg-purple-500",
                text: "text-purple-600",
              },
              {
                key: "gpms",
                label: "GPMS 啟動",
                color: "bg-cyan-500",
                text: "text-cyan-600",
              },
              {
                key: "mt",
                label: "PCB 維護",
                color: "bg-rose-500",
                text: "text-rose-600",
              },
            ],
            m = $.length <= 2 ? "grid-cols-1 md:grid-cols-2" : 3 === $.length ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-4";
          ((p.className = `grid ${m} gap-4`),
            (p.innerHTML = $.map((t) => {
              let e = d[t];
              return `<div class="p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
                      <div class="flex items-center mb-3 pb-2 border-b border-gray-100">
                      <h5 class="font-bold text-gray-700">👤 ${t}</h5></div>
                      <div class="grid gap-2 grid-cols-3 text-xs">${i
                        .map(
                          (t) => `<div class="flex items-center gap-2 p-2 rounded ${e[t.key] > 0 ? "bg-gray-50" : "opacity-40"}">
                      <div class="w-2 h-2 rounded-full ${t.color}"></div>
                      <span class="text-gray-500">${t.label}</span>
                      <span class="ml-auto font-bold ${t.text}">${e[t.key]}</span></div>`,
                        )
                        .join("")}</div></div>`;
            }).join("")));
        }
      }

      /* GPMS 啟動清單 */
      function renderGPMSPage(e = null) {
        (SyncTimeModule.update("fileTime_p8", 8), renderGPMSSidebar(), renderGPMSTable(e));
      }
      function renderGPMSSidebar() {
        renderGenericSidebar(pcbStore.gpms, "date", "yearSelect_p8", "gpmsSidebarBody");
      }
      function updateGPMSRow(e, a, t) {
        updateGenericRow({
          dataArray: pcbStore.gpms,
          index: e,
          field: a,
          value: t,
          yearSelectId: "yearSelect_p8",
          dateField: "date",
          renderFn(e) {
            (renderGPMSSidebar(), renderGPMSTable(e));
          },
          triggerPageId: 8,
          dataType: "pcb_gpms",
        });
      }
      function renderGPMSTable(e = null) {
        let t = document.getElementById("gpmsBody");
        if (!t) return;
        let a = [...new Set(pcbStore.gpms.map((e) => DateUtils.normalizeYear(e.date)).filter((e) => e))].sort().reverse();
        let r = Utils.initYearSelect("yearSelect_p8", a, "年", !0);
        let searchKw = document.getElementById("searchBox_p8")?.value || "",
          raw = pcbStore.gpms.map((e, t) => ({ ...e, _origIdx: t }));
        let l = SearchModule.filterData(raw, "p8", searchKw, !1, (e) => !r || r === "ALL" || !e.date || DateUtils.normalizeYear(e.date) === r);
        paginationState.p8 || (paginationState.p8 = 1);
        renderPaginationControls("pagination_p8", "p8", l.length, "renderGPMSTable");
        let p = getPaginatedData(l, "p8"),
          { ro: roAttr, dis: disAttr, inputCls, txtCls } = Utils.authAttrs(),
          inputFull = inputCls + " w-full",
          y = "p-2 border-b align-top",
          z = "p-2 border-b align-top text-center",
          txtFull = txtCls + " break-words whitespace-pre-wrap";
        t.innerHTML = p
          .map((t) => {
            let a = t._origIdx;
            return `<tr class="hover:bg-gray-50 group ${t._dirty ? "row-dirty" : ""} ${null !== e && a === e ? "highlight-row" : ""}" data-idx="${a}">
                  <td class="${z}">${Utils.escapeHtml(DateUtils.formatDisplay(t.date))}</td>
                  <td class="${z}">${Utils.escapeHtml(t.pcbNo)}</td>
                  <td class="${y}">${Utils.escapeHtml(t.partNo)}</td>
                  <td class="${y}">${Utils.escapeHtml(t.maintainer)}</td>
                  <td class="${y}"><textarea rows="1" class="${txtFull}" style="min-height:24px" placeholder="" ${roAttr} oninput="Utils.autoResize(this)" onchange="updateGPMSRow(${a},'note',this.value)">${Utils.escapeHtml(t.note)}</textarea></td>
                  </tr>`;
          })
          .join("");
        setTimeout(() => {
          t.querySelectorAll("textarea").forEach((t) => Utils.autoResize(t));
        }, 0);
        updateAuthUI();
      }
      /* PCB 維護清單 */
      function renderPCBMaintainPage(n = null) {
        (renderFileTimeLabel("fileTime_p9", 9), renderPCBMaintainSidebar(), renderPCBMaintainTable(n));
      }
      function renderPCBMaintainSidebar() {
        renderGenericSidebar(pcbStore.maintain, "date", "yearSelect_p9", "pcbMaintainSidebarBody");
      }
      function renderPCBMaintainTable(t = null) {
        let e = document.getElementById("pcbMaintainBody");
        if (!e) return;
        let a = [...new Set(pcbStore.maintain.map((t) => DateUtils.normalizeYear(t.date)).filter((t) => t))].sort().reverse();
        Utils.initYearSelect("yearSelect_p9", a, "年", !0);
        let searchKw = document.getElementById("searchBox_p9")?.value || "",
          r = document.getElementById("yearSelect_p9")?.value;
        let i = pcbStore.maintain.map((t, e) => ({ ...t, _origIdx: e }));
        let filtered = SearchModule.filterData(i, "p9", searchKw, !1, (t) => !r || r === "ALL" || !t.date || DateUtils.normalizeYear(t.date) === r);
        renderPaginationControls("pagination_p9", "p9", filtered.length, "renderPCBMaintainTable");
        let n = getPaginatedData(filtered, "p9"),
          { ro: roAttr, dis: disAttr, inputCls, txtCls } = Utils.authAttrs(),
          inputFull = inputCls + " w-full",
          y = "p-2 border-b align-top",
          z = "p-2 border-b align-top text-center",
          txtFull = txtCls + " break-words whitespace-pre-wrap";
        e.innerHTML = n
          .map((e) => {
            let a = e._origIdx,
              r = generateDynamicOptions("pcb_category", e.type),
              i = e.category || "";
            return `<tr class="hover:bg-gray-50 group ${e._dirty ? "row-dirty" : ""} ${null !== t && a === t ? "highlight-row" : ""}" data-idx="${a}">
                  <td class="${z} auth-only"><button class="text-gray-400 opacity-0 transition-colors hover:text-red-600 group-hover:opacity-100" onclick="deleteGeneralRow('pcbMaintain', ${a})"><i class="fa-solid fa-trash-can"></i></button></td>
                  <td class="${z}"><input type="text" value="${DateUtils.formatDisplay(e.date)}" class="${inputFull} flatpickr-maintain text-center" ${roAttr} data-idx="${a}" placeholder="選擇日期"></td>
                  <td class="${y}"><input type="text" value="${Utils.escapeHtml(e.partNo)}" class="${inputFull}" placeholder="料號" ${roAttr} onchange="updatePCBMaintainRow(${a},'partNo',this.value)"></td>
                  <td class="${y}"><select class="${inputFull}" ${disAttr} onchange="updatePCBMaintainRow(${a},'maintainer',this.value)">${generateMaintainerOptions(e.maintainer)}</select></td>
                  <td class="${y}"><select class="${inputFull}" ${disAttr} onchange="updatePCBMaintainRow(${a},'type',this.value)">${r}</select></td>
                  <td class="${y}"><textarea rows="1" class="${txtFull}" style="min-height:24px" placeholder="" ${roAttr} oninput="Utils.autoResize(this)" onchange="updatePCBMaintainRow(${a},'category',this.value)">${Utils.escapeHtml(i)}</textarea></td>
                  </tr>`;
          })
          .join("");
        setTimeout(() => {
          e.querySelectorAll("textarea").forEach((t) => Utils.autoResize(t));
        }, 0);
        updateAuthUI();
        FlatpickrManager.init(".flatpickr-maintain", (t, e) => {
          updatePCBMaintainRow(parseInt(t.dataset.idx), "date", e);
        });
      }
      function updatePCBMaintainRow(e, a, t) {
        updateGenericRow({
          dataArray: pcbStore.maintain,
          index: e,
          field: a,
          value: t,
          yearSelectId: "yearSelect_p9",
          dateField: "date",
          renderFn(e) {
            (renderPCBMaintainSidebar(), renderPCBMaintainTable(e));
          },
          triggerPageId: 9,
          dataType: "pcb_maint",
        });
      }
      function addNewPCBMaintainRow() {
        addGenericRow({
          dataArray: pcbStore.maintain,
          defaultRow: {
            date: "",
            partNo: "",
            maintainer: "",
            type: "",
            category: "",
          },
          paginationKey: "p9",
          renderFn: renderPCBMaintainPage,
          triggerPageId: 9,
          scrollSelector: "#page9 #pcbMaintainScrollContainer .overflow-auto",
          dataType: "pcb_maint",
        });
      }

      // ==========================================
      // 12. 其他統計模組 (Page 11, 12, 14, 17, 18, 20)
      // ==========================================
      /* 其他類別統計報告 (Page 18) */
      function renderOtherReport() {
        let monthlyStats = {},
          yearDates = [],
          collectDate = (t) => {
            t && yearDates.push(t);
          };
        (plmData || []).forEach((t) => collectDate(t.date));
        (assistData || []).forEach((t) => collectDate(t.date));
        (disableSubData || []).forEach((t) => collectDate(t.date));
        (bomData || []).forEach((t) => collectDate(t.completeDate));
        (dccData || []).forEach((t) => collectDate(t.date));
        let years = [...new Set(yearDates.map((t) => DateUtils.normalizeYear(t)).filter((t) => t))].sort().reverse();
        Utils.initYearSelect("otherReportYearSelect", years, "年", false);
        let selectedYear = document.getElementById("otherReportYearSelect")?.value || years[0] || new Date().getFullYear().toString();
        let totals = { plm: 0, assist: 0, disable: 0, bom: 0, dcc: 0 },
          personStats = {};
        let activeMaintainers = getActiveMaintainers();
        activeMaintainers.forEach((name) => {
          personStats[name] = { plm: 0, assist: 0, disable: 0, bom: 0, dcc: 0 };
        });
        let getPersonKey = (t) => (t && activeMaintainers.find((n) => t.includes(n))) || null;
        let countItem = (date, type, person) => {
          if (date && DateUtils.normalizeYear(date) === selectedYear) {
            let month = DateUtils.normalizeMonth(date);
            if (!monthlyStats[month]) monthlyStats[month] = { plm: 0, assist: 0, disable: 0, bom: 0, dcc: 0 };
            monthlyStats[month][type]++;
            totals[type]++;
            let key = getPersonKey(person);
            if (key) personStats[key][type]++;
          }
        };
        (plmData || []).forEach((t) => countItem(t.date, "plm", t.executor));
        (assistData || []).forEach((t) => countItem(t.date, "assist", t.person));
        (disableSubData || []).forEach((t) => countItem(t.date, "disable", t.executor));
        (bomData || []).forEach((t) => countItem(t.completeDate, "bom", t.executor));
        (dccData || []).forEach((t) => countItem(t.date, "dcc", t.executor));
        let months = Object.keys(monthlyStats).sort().reverse();
        renderKPICards("otherKpiCards", [
          { label: "資料匯出", val: totals.plm, color: "bg-blue-500" },
          { label: "協助項目", val: totals.assist, color: "bg-emerald-500" },
          { label: "停用取替", val: totals.disable, color: "bg-amber-500" },
          { label: "BOM 建立", val: totals.bom, color: "bg-purple-500" },
          { label: "管制文件", val: totals.dcc, color: "bg-cyan-500" },
        ]);
        let tbody = document.getElementById("otherReportBody");
        if (tbody) {
          if (months.length) {
            tbody.innerHTML = months
              .map((m) => {
                let s = monthlyStats[m];
                return `<tr class="transition-colors hover:bg-gray-50">
                  <td class="p-3 pl-6 font-bold text-left text-gray-600 border-b">${DateUtils.formatMonthDisplay(m)}</td>
                  <td class="p-3 font-bold text-blue-600 border-b">${s.plm || 0}</td>
                  <td class="p-3 font-bold text-emerald-600 border-b">${s.assist || 0}</td>
                  <td class="p-3 font-bold text-amber-600 border-b">${s.disable || 0}</td>
                  <td class="p-3 font-bold text-purple-600 border-b">${s.bom || 0}</td>
                  <td class="p-3 font-bold text-cyan-600 border-b">${s.dcc || 0}</td></tr>`;
              })
              .join("");
            tbody.innerHTML += `<tr class="font-bold bg-gray-100">
                  <td class="p-3 pl-6 text-left text-gray-700 border-b">年度合計</td>
                  <td class="p-3 text-blue-600 border-b">${totals.plm}</td>
                  <td class="p-3 text-emerald-600 border-b">${totals.assist}</td>
                  <td class="p-3 text-amber-600 border-b">${totals.disable}</td>
                  <td class="p-3 text-purple-600 border-b">${totals.bom}</td>
                  <td class="p-3 text-cyan-600 border-b">${totals.dcc}</td></tr>`;
          } else {
            tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-400">該年度無數據</td></tr>`;
          }
        }
        let personDiv = document.getElementById("otherPersonStats");
        if (personDiv) {
          let items = [
            {
              key: "plm",
              label: "資料匯出",
              color: "bg-blue-500",
              text: "text-blue-600",
            },
            {
              key: "assist",
              label: "協助項目",
              color: "bg-emerald-500",
              text: "text-emerald-600",
            },
            {
              key: "disable",
              label: "停用取替",
              color: "bg-amber-500",
              text: "text-amber-600",
            },
            {
              key: "bom",
              label: "BOM 建立",
              color: "bg-purple-500",
              text: "text-purple-600",
            },
            {
              key: "dcc",
              label: "管制文件",
              color: "bg-cyan-500",
              text: "text-cyan-600",
            },
          ];
          let gridClass = activeMaintainers.length <= 2 ? "grid-cols-1 md:grid-cols-2" : activeMaintainers.length === 3 ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-4";
          personDiv.className = `grid ${gridClass} gap-4`;
          personDiv.innerHTML = activeMaintainers
            .map((name) => {
              let stats = personStats[name];
              return `<div class="p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
                      <div class="flex items-center mb-3 pb-2 border-b border-gray-100">
                      <h5 class="font-bold text-gray-700">👤 ${name}</h5></div>
                      <div class="grid gap-2 grid-cols-2 text-xs">${items
                        .map(
                          (item) => `<div class="flex items-center gap-2 p-2 rounded ${stats[item.key] > 0 ? "bg-gray-50" : "opacity-40"}">
                      <div class="w-2 h-2 rounded-full ${item.color}"></div>
                      <span class="text-gray-500">${item.label}</span>
                      <span class="ml-auto font-bold ${item.text}">${stats[item.key]}</span></div>`,
                        )
                        .join("")}</div></div>`;
            })
            .join("");
        }
      }

      /* 資料匯出統計 (Page 11) */
      function renderPLMPage() {
        (renderFileTimeLabel("fileTime_p11", 11), renderPLMSidebar(), renderPLMTable());
      }
      function renderPLMSidebar() {
        renderGenericSidebar(plmData, "date", "plmYearSelect", "plmSidebarBody");
      }
      function renderPLMTable(e = null) {
        let t = document.getElementById("plmBody"),
          r = document.getElementById("plmYearSelect")?.value,
          a = (plmData || []).map((e, t) => ({ ...e, _origIdx: t })).filter((e) => r === "ALL" || !e.date || DateUtils.normalizeYear(e.date) === r);
        renderPaginationControls("pagination_p11", "p11", a.length, "renderPLMTable");
        let l = getPaginatedData(a, "p11"),
          { ro: roAttr, dis: disAttr, inputCls } = Utils.authAttrs(),
          y = "p-2 border-b",
          z = "p-2 border-b text-center",
          inputFull = inputCls + " w-full";
        ((t.innerHTML = l
          .map((t) => {
            let r = t._origIdx,
              a = generateDynamicOptions("plm_category", t.category);
            return `<tr class="hover:bg-gray-50 group ${t._dirty ? "row-dirty" : ""} ${null !== e && r === e ? "highlight-row" : ""}" data-idx="${r}">
                  <td class="${z} auth-only"><button class="text-gray-400 opacity-0 hover:text-red-600 group-hover:opacity-100" onclick="deleteGeneralRow('plm', ${r})"><i class="fa-solid fa-trash-can"></i></button></td>
                  <td class="${z}"><input type="text" class="${inputFull} flatpickr-plm text-center" value="${DateUtils.formatDisplay(t.date)}" ${roAttr} data-idx="${r}" placeholder="選擇日期"></td>
                  <td class="${z}">${t.week || "-"}</td>
                  <td class="${y}"><select class="${inputFull}" ${disAttr} onchange="updatePLMRow(${r},'category',this.value)">${a}</select></td>
                  <td class="${y}"><select class="${inputFull}" style="text-align-last:center"${disAttr} onchange="updatePLMRow(${r},'executor',this.value)">${generateMaintainerOptions(t.executor)}</select></td>
                  </tr>`;
          })
          .join("")),
          updateAuthUI(),
          FlatpickrManager.init(".flatpickr-plm", (e, t) => {
            updatePLMRow(parseInt(e.dataset.idx), "date", t);
          }));
      }
      function addPLMRow() {
        addGenericRow({
          dataArray: plmData,
          defaultRow: { date: "", week: "", category: "", executor: "" },
          paginationKey: "p11",
          renderFn: renderPLMPage,
          triggerPageId: 11,
          scrollSelector: "#page11 #plmScrollContainer .overflow-auto",
          dataType: "plm",
        });
      }
      function updatePLMRow(e, a, t) {
        updateGenericRow({
          dataArray: plmData,
          index: e,
          field: a,
          value: t,
          yearSelectId: "plmYearSelect",
          dateField: "date",
          renderFn(e) {
            (renderPLMSidebar(), renderPLMTable(e));
          },
          triggerPageId: 11,
          dataType: "plm",
          afterUpdate(e, a, t) {
            if ("date" === a) {
              let d = DateUtils.parse(t);
              d && (e.week = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()]);
            }
          },
        });
      }

      /* 協助項目統計 (Page 12) */
      function renderAssistPage() {
        (renderFileTimeLabel("fileTime_p12", 12), renderAssistSidebar(), renderAssistTable());
      }

      function renderAssistSidebar() {
        let t = [...new Set((assistData || []).map((t) => DateUtils.normalizeYear(t.date)).filter((t) => t))].sort().reverse(),
          e = Utils.initYearSelect("assistYearSelect", t, "年", !0),
          r = "ALL" === e,
          s = {};
        (assistData || [])
          .filter((t) => r || !t.date || DateUtils.normalizeYear(t.date) === e)
          .forEach((t) => {
            let e = DateUtils.normalizeMonth(t.date) || "未知";
            (s[e] || (s[e] = { total: 0, internal: 0, cross: 0 }), s[e].total++, "跨部門" === t.category ? s[e].cross++ : "內部" === t.category && s[e].internal++);
          });
        let a = Object.keys(s).sort().reverse(),
          l = document.getElementById("assistSidebarBody");
        l &&
          (l.innerHTML = a.length
            ? a
                .map((t) => {
                  let e = s[t];
                  return `<tr class="transition-colors hover:bg-gray-50">
                  <td class="px-2 py-3 pl-4 font-bold text-left text-gray-600 border-b">${DateUtils.formatMonthDisplay(t, r)}</td>
                  <td class="px-2 py-3 font-bold text-center text-ms-blue border-b">${e.total} 筆</td>
                  <td class="px-2 py-3 font-bold text-center text-emerald-600 border-b">${e.internal}</td>
                  <td class="px-2 py-3 font-bold text-center text-amber-600 border-b">${e.cross}</td>
                  </tr>`;
                })
                .join("")
            : '<tr><td colspan="4" class="p-4 text-center text-gray-400">尚無數據</td></tr>');
      }

      function renderAssistTable(t = null) {
        let e = document.getElementById("assistBody");
        if (!e) return;
        let { ro: roAttr, dis: disAttr, inputCls, txtCls } = Utils.authAttrs(),
          o = document.getElementById("assistYearSelect")?.value,
          searchKw = document.getElementById("searchBox_p12")?.value || "",
          txtFull = txtCls + " break-words whitespace-pre-wrap",
          inputFull = inputCls + " w-full",
          y = "p-2 border-b align-top",
          z = "p-2 border-b align-top text-center",
          raw = (assistData || []).map((t, e) => ({ ...t, _origIdx: e }));
        let d = SearchModule.filterData(raw, "p12", searchKw, !1, (t) => !o || o === "ALL" || !t.date || DateUtils.normalizeYear(t.date) === o);
        paginationState.p12 || (paginationState.p12 = 1);
        renderPaginationControls("pagination_p12", "p12", d.length, "renderAssistTable");
        let c = getPaginatedData(d, "p12");
        e.innerHTML = c
          .map((e) => {
            let r = e._origIdx,
              l = generateDynamicOptions("assist_category", e.category);
            return `<tr class="hover:bg-gray-50 group ${e._dirty ? "row-dirty" : ""} ${null !== t && r === t ? "highlight-row" : ""}" data-idx="${r}">
                  <td class="${z} auth-only"><button class="mt-1 text-gray-400 opacity-0 hover:text-red-600 group-hover:opacity-100" onclick="deleteGeneralRow('assist', ${r})"><i class="fa-solid fa-trash-can"></i></button></td>
                  <td class="${z}"><input type="text" class="${inputFull} flatpickr-assist text-center" value="${DateUtils.formatDisplay(e.date)}" ${roAttr} data-idx="${r}" placeholder="選擇日期"></td>
                  <td class="${y}"><select class="${inputFull} text-gray-800" style="text-align-last:center" ${disAttr} onchange="updateAssistRow(${r}, 'category', this.value)">${l}</select></td>
                  <td class="${y}"><textarea rows="1" class="${txtFull}" style="min-height:24px" placeholder="輸入內容" ${roAttr} oninput="Utils.autoResize(this)" onchange="updateAssistRow(${r}, 'content', this.value)">${Utils.escapeHtml(e.content)}</textarea></td>
                  <td class="${y}"><select class="${inputFull}" ${disAttr} onchange="updateAssistRow(${r}, 'person', this.value)">${generateMaintainerOptions(e.person)}</select></td>
                  <td class="${y}"><textarea rows="1" class="${txtFull}" style="min-height:24px" placeholder="備註" ${roAttr} oninput="Utils.autoResize(this)" onchange="updateAssistRow(${r}, 'note', this.value)">${Utils.escapeHtml(e.note)}</textarea></td>
                  </tr>`;
          })
          .join("");
        setTimeout(() => {
          if ((e.querySelectorAll("textarea").forEach((t) => Utils.autoResize(t)), null !== t)) {
            let a = e.querySelector(".highlight-row");
            a && a.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 0);
        updateAuthUI();
        FlatpickrManager.init(".flatpickr-assist", (t, e) => {
          let a = parseInt(t.dataset.idx);
          updateAssistRow(a, "date", e);
        });
      }

      function addAssistRow() {
        addGenericRow({
          dataArray: assistData,
          defaultRow: {
            date: "",
            category: "",
            content: "",
            person: "",
            note: "",
          },
          paginationKey: "p12",
          renderFn: renderAssistPage,
          triggerPageId: 12,
          scrollSelector: "#page12 #assistScrollContainer .overflow-auto",
          dataType: "assist",
        });
      }
      function updateAssistRow(e, a, t) {
        updateGenericRow({
          dataArray: assistData,
          index: e,
          field: a,
          value: t,
          yearSelectId: "assistYearSelect",
          dateField: "date",
          renderFn(e) {
            (renderAssistSidebar(), renderAssistTable(e));
          },
          triggerPageId: 12,
          dataType: "assist",
          afterUpdate(e, a) {
            "category" === a && renderAssistSidebar();
          },
        });
      }

      /* 管制文件申請統計 (Page 19) */
      function renderDccPage() {
        (renderFileTimeLabel("fileTime_p19", 19), renderDccSidebar(), renderDccTable());
      }
      function renderDccSidebar() {
        renderGenericSidebar(dccData, "date", "dccYearSelect", "dccSidebarBody");
      }
      function renderDccTable(t = null) {
        let e = document.getElementById("dccBody");
        if (!e) return;
        let { ro: roAttr, dis: disAttr, inputCls, txtCls } = Utils.authAttrs(),
          o = document.getElementById("dccYearSelect")?.value,
          searchKw = document.getElementById("searchBox_p19")?.value || "",
          txtFull = txtCls + " break-words whitespace-pre-wrap",
          inputFull = inputCls + " w-full",
          y = "p-2 border-b align-top",
          z = "p-2 border-b align-top text-center",
          raw = (dccData || []).map((t, e) => ({ ...t, _origIdx: e }));
        let d = SearchModule.filterData(raw, "p19", searchKw, !1, (t) => !o || o === "ALL" || !t.date || DateUtils.normalizeYear(t.date) === o);
        paginationState.p19 || (paginationState.p19 = 1);
        renderPaginationControls("pagination_p19", "p19", d.length, "renderDccTable");
        let c = getPaginatedData(d, "p19");
        e.innerHTML = c
          .map((e) => {
            let r = e._origIdx;
            return `<tr class="hover:bg-gray-50 group ${e._dirty ? "row-dirty" : ""} ${null !== t && r === t ? "highlight-row" : ""}" data-idx="${r}">
                  <td class="${z} auth-only"><button class="mt-1 text-gray-400 opacity-0 hover:text-red-600 group-hover:opacity-100" onclick="deleteGeneralRow('dcc', ${r})"><i class="fa-solid fa-trash-can"></i></button></td>
                  <td class="${z}"><input type="text" class="${inputFull} flatpickr-dcc text-center" value="${DateUtils.formatDisplay(e.date)}" ${roAttr} data-idx="${r}" placeholder="選擇日期"></td>
                  <td class="${y}"><input type="text" class="${inputFull}" placeholder="申請人" value="${Utils.escapeHtml(e.applicant)}" ${roAttr} onchange="updateDccRow(${r}, 'applicant', this.value)"></td>
                  <td class="${y}"><input type="text" class="${inputFull}" placeholder="申請單位" value="${Utils.escapeHtml(e.unit)}" ${roAttr} onchange="updateDccRow(${r}, 'unit', this.value)"></td>
                  <td class="${y}"><textarea rows="1" class="${txtFull}" style="min-height:24px" placeholder="輸入內容" ${roAttr} oninput="Utils.autoResize(this)" onchange="updateDccRow(${r}, 'content', this.value)">${Utils.escapeHtml(e.content)}</textarea></td>
                  <td class="${y}"><select class="${inputFull}" ${disAttr} onchange="updateDccRow(${r}, 'executor', this.value)">${generateMaintainerOptions(e.executor)}</select></td>
                  <td class="${y}"><textarea rows="1" class="${txtFull}" style="min-height:24px" placeholder="備註" ${roAttr} oninput="Utils.autoResize(this)" onchange="updateDccRow(${r}, 'note', this.value)">${Utils.escapeHtml(e.note)}</textarea></td>
                  </tr>`;
          })
          .join("");
        setTimeout(() => {
          if ((e.querySelectorAll("textarea").forEach((t) => Utils.autoResize(t)), null !== t)) {
            let a = e.querySelector(".highlight-row");
            a && a.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 0);
        updateAuthUI();
        FlatpickrManager.init(".flatpickr-dcc", (t, e) => {
          let a = parseInt(t.dataset.idx);
          updateDccRow(a, "date", e);
        });
      }
      function addDccRow() {
        addGenericRow({
          dataArray: dccData,
          defaultRow: { date: "", applicant: "", unit: "", content: "", executor: "", note: "" },
          paginationKey: "p19",
          renderFn: renderDccPage,
          triggerPageId: 19,
          scrollSelector: "#page19 #dccScrollContainer .overflow-auto",
          dataType: "dcc",
        });
      }
      function updateDccRow(e, a, t) {
        updateGenericRow({
          dataArray: dccData,
          index: e,
          field: a,
          value: t,
          yearSelectId: "dccYearSelect",
          dateField: "date",
          renderFn(e) {
            (renderDccSidebar(), renderDccTable(e));
          },
          triggerPageId: 19,
          dataType: "dcc",
        });
      }

      /* 停用取替代統計 (Page 14) */
      function renderDisablePage() {
        (renderFileTimeLabel("fileTime_p14", 14), renderDisableSidebar(), renderDisableTable(), updateUndisabledBtnVisibility());
      }
      function renderDisableSidebar() {
        renderGenericSidebar(disableSubData, "date", "disableYearSelect", "disableSidebarBody");
      }
      function renderDisableTable(e = null) {
        let t = document.getElementById("disableBody");
        if (!t) return;
        let a = document.getElementById("disableYearSelect")?.value,
          searchKw = document.getElementById("searchBox_p14")?.value || "",
          raw = (disableSubData || []).map((e, t) => ({ ...e, _idx: t })),
          r = SearchModule.filterData(raw, "p14", searchKw, false, (e) => a === "ALL" || !e.date || DateUtils.normalizeYear(e.date) === a);
        renderPaginationControls("pagination_p14", "p14", r.length, "renderDisableTable");
        let l = getPaginatedData(r, "p14"),
          { ro: roAttr, dis: disAttr, inputCls, txtCls } = Utils.authAttrs(),
          inputFull = inputCls + " w-full",
          y = "p-2 border-b align-top",
          z = "p-2 border-b align-top text-center",
          txtFull = txtCls + " break-words whitespace-pre-wrap";
        ((t.innerHTML = l
          .map((t) => {
            let a = t._idx;
            return `<tr class="hover:bg-gray-50 group ${t._dirty ? "row-dirty" : ""} ${null !== e && a === e ? "highlight-row" : ""}" data-idx="${a}">
                  <td class="${z} auth-only"><button class="mt-1 text-gray-400 opacity-0 hover:text-red-600 group-hover:opacity-100" onclick="deleteGeneralRow('disable', ${a})"><i class="fa-solid fa-trash-can"></i></button></td>
                  <td class="${z}"><input type="text" class="${inputFull} flatpickr-disable text-center" value="${DateUtils.formatDisplay(t.date)}" ${roAttr} data-idx="${a}" placeholder="選擇日期"></td>
                  <td class="${y}"><input type="text" class="${inputFull}" value="${Utils.escapeHtml(t.ecnNo)}" placeholder="ECN單號" ${roAttr} onchange="updateDisableRow(${a},'ecnNo',this.value)"></td>
                  <td class="${z}"><span class="font-bold">${t.tier || "-"}</span></td>
                  <td class="${y}"><textarea rows="1" class="${txtFull}" style="min-height:24px" placeholder="料號 (自動偵測階層)" ${roAttr} oninput="Utils.autoResize(this)" onchange="updateDisableRow(${a},'partNo',this.value)">${Utils.escapeHtml(t.partNo)}</textarea></td>
                  <td class="${y}"><select class="${inputFull}" ${disAttr} onchange="updateDisableRow(${a},'executor',this.value)">${generateMaintainerOptions(t.executor)}</select></td>
                  <td class="${y}"><textarea rows="1" class="${txtFull}" style="min-height:24px" placeholder="備註" ${roAttr} oninput="Utils.autoResize(this)" onchange="updateDisableRow(${a},'note',this.value)">${Utils.escapeHtml(t.note)}</textarea></td>
                  </tr>`;
          })
          .join("")),
          setTimeout(() => {
            if ((t.querySelectorAll("textarea").forEach((e) => Utils.autoResize(e)), null !== e)) {
              let a = t.querySelector(".highlight-row");
              a && a.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }, 0),
          updateAuthUI(),
          FlatpickrManager.init(".flatpickr-disable", (e, t) => {
            updateDisableRow(parseInt(e.dataset.idx), "date", t);
          }));
      }
      function addDisableRow() {
        addGenericRow({
          dataArray: disableSubData,
          defaultRow: {
            date: "",
            ecnNo: "",
            tier: "",
            partNo: "",
            executor: "",
            note: "",
          },
          paginationKey: "p14",
          renderFn: renderDisablePage,
          triggerPageId: 14,
          scrollSelector: "#page14 #disableScrollContainer .overflow-auto",
          dataType: "disable",
        });
      }
      /* PAGE14 批次貼上 */
      const disablePasteConfig = {
        columns: [
          { key: "date",   label: "日期",    col: 0, required: false, type: "date" },
          { key: "ecnNo",  label: "ECN單號", col: 1 },
          { key: "partNo", label: "料號",    col: 2, required: true },
          { key: "note",   label: "備註",    col: 3 },
        ],
        extraFields: [
          { key: "executor", label: "套用執行人", type: "select", options: () => getActiveMaintainers() },
        ],
        placeholder: "在此貼上從 Excel 複製的資料（Ctrl+V）\n\n欄位順序：A 日期 › B ECN單號 › C 料號 › D 備註（可省略）",
        afterParse(row) {
          row.tier = detectTier(row.partNo);
          row._dirty = true;
          row._isNew = true;
        },
        onConfirm(rows) {
          for (let i = rows.length - 1; i >= 0; i--) {
            const newRow = { ...rows[i] };
            disableSubData.unshift(newRow);
            YearlyModule.markDirtyFromRecord("disable", newRow);
          }
          paginationState["p14"] = 1;
          renderDisablePage();
          updateSaveButtonStatus();
          setTimeout(() => {
            document.querySelector("#page14 #disableScrollContainer .overflow-auto")?.scrollTo({ top: 0, behavior: "smooth" });
          }, 0);
          ToastModule.show(`已新增 ${rows.length} 筆資料，請記得儲存`, "success");
        },
      };

      function openDisablePasteModal() {
        BatchPasteModule.open(disablePasteConfig);
      }

      /* 算 P1 ECN 符合「變更為停用」條件但未在 P14 停用取替代表的清單
         條件：
         1. ecnData[].scope 含「變更為停用」
         2. ecnData[].partNo 以 "9-" 或 "9_" 開頭
         3. ecnData[].approver 非 KPI 目標（!isKPITarget，例如 Judy/Ollie）
         4. ecnData[].id 不在 disableSubData[].ecnNo 集合中 */
      function getUndisabledEcns() {
        const candidates = (ecnData || []).filter((r) => {
          const scopeOk = (r.scope || "").includes("變更為停用");
          const partOk = (r.partNo || "").includes("9-") || (r.partNo || "").includes("9_");
          const nonKpi = !isKPITarget(r.approver);
          return scopeOk && partOk && nonKpi;
        });
        const disableSet = new Set((disableSubData || []).map((d) => d.ecnNo).filter(Boolean));
        return { candidates, missing: candidates.filter((c) => !disableSet.has(c.id)) };
      }
      /* 切到 P14 / ECN 同步完成後呼叫：有遺漏才顯示警示按鈕 */
      function updateUndisabledBtnVisibility() {
        const btn = document.getElementById("undisabledEcnBtn");
        if (!btn) return;
        const { missing } = getUndisabledEcns();
        btn.style.display = missing.length ? "" : "none";
      }
      function showUndisabledEcnModal() {
        const { missing } = getUndisabledEcns();
        const body = document.getElementById("undisabledEcnBody");
        if (!missing.length) {
          body.innerHTML = `<div class="text-center py-8"><i class="fa-solid fa-circle-check text-emerald-500 text-4xl mb-3 block"></i><div class="text-sm text-gray-700">符合條件的 ECN 都已在停用取替代表內</div></div>`;
        } else {
          body.innerHTML = `
            <div class="mb-3 text-xs text-gray-600">共 <b class="text-red-600 text-sm">${missing.length}</b> 筆 ECN 符合條件但尚未停用取替代料</div>
            <div class="text-sm text-gray-700 leading-7">${missing.map((m) => Utils.escapeHtml(m.id)).join("<br>")}</div>`;
        }
        document.getElementById("undisabledEcnModal").classList.add("show");
      }

      function updateDisableRow(e, a, d) {
        updateGenericRow({
          dataArray: disableSubData,
          index: e,
          field: a,
          value: d,
          yearSelectId: "disableYearSelect",
          dateField: "date",
          renderFn(e) {
            (renderDisableSidebar(), renderDisableTable(e));
          },
          triggerPageId: 14,
          dataType: "disable",
          afterUpdate(e, a, d) {
            "partNo" === a && (e.tier = detectTier(d));
          },
        });
      }
      function detectTier(t) {
        if (!t) return "";
        let r = t.trim();
        return r.startsWith("9-") || r.startsWith("9_") ? "9" : r.startsWith("5-85") ? "585" : r.startsWith("5-80") ? "580" : r.startsWith("5-70") ? "570" : r.startsWith("8-") ? "8" : "其他";
      }

      /* BOM 建立 (Page 17) */
      function getBOMSortDate(record) {
        if (record.completeDate === "取消") {
            return record.updateDate || record.receiveDate || "";
        }
        return record.completeDate || "";
      }
      YearlyModule.getDateFns.bom = getBOMSortDate;
      function renderBOMPage() {
        (renderFileTimeLabel("fileTime_p17", 17), renderBOMSidebar(), renderBOMTable());
      }
      function renderBOMSidebar() {
        renderGenericSidebar(bomData, "completeDate", "bomYearSelect", "bomSidebarBody");
      }

      function renderBOMTable(e = null) {
        let t = document.getElementById("bomBody");
        if (!t) return;
        let a = document.getElementById("bomYearSelect")?.value,
          searchKw = document.getElementById("searchBox_p17")?.value || "",
          raw = (bomData || []).map((item, idx) => {
            const isCancelled = item.completeDate === "取消";
            const startDate = item.updateDate || item.receiveDate;
            const workDays = isCancelled ? "-" : DateUtils.calcWorkDays(startDate, item.completeDate);
            const limit = OverdueModule.getThresholdPage17(item.priority);
            const isOverdue = !isCancelled && limit && typeof workDays === "number" && workDays > limit;
            return {
                ...item,
                _idx: idx,
                _workDays: workDays,
                _stage: getStageFromPartNo(item.partNo),
                _isOverdue: isOverdue ? "逾期" : (isCancelled ? "取消" : "")
            };
          });
        let r = SearchModule.filterData(raw, "p17", searchKw, !1, (e) => {
          if (!a || a === "ALL") return true;
          const sortDate = getBOMSortDate(e);
          return !sortDate || DateUtils.normalizeYear(sortDate) === a;
        });
        renderPaginationControls("pagination_p17", "p17", r.length, "renderBOMTable");
        let l = getPaginatedData(r, "p17"),
          { ro: roAttr, dis: disAttr, inputCls, txtCls } = Utils.authAttrs(),
          inputFull = inputCls + " w-full",
          y = "p-2 border-b align-top",
          z = "p-2 border-b align-top text-center",
          txtFull = txtCls + " break-words whitespace-pre-wrap";
        t.innerHTML = l
          .map((t) => {
            let a = t._idx,
                r = generateDynamicOptions("board_applicant", t.applicant);
              const isCancelled = t.completeDate === '取消';
              let workDays = isCancelled ? "-" : DateUtils.calcWorkDays(t.updateDate || t.receiveDate, t.completeDate);
              const stage = getStageFromPartNo(t.partNo);
            return `<tr class="hover:bg-gray-50 group ${t._dirty ? "row-dirty" : ""} ${null !== e && a === e ? "highlight-row" : ""}" data-idx="${a}">
                  <td class="${z} auth-only"><button class="mt-1 text-gray-400 opacity-0 hover:text-red-600 group-hover:opacity-100" onclick="deleteGeneralRow('bom', ${a})"><i class="fa-solid fa-trash-can"></i></button></td>
                  <td class="${z}"><input type="text" class="${inputFull} flatpickr-bom text-center" value="${DateUtils.formatDisplay(t.receiveDate)}" ${roAttr} data-idx="${a}" data-field="receiveDate" placeholder="選擇日期"></td>
                  <td class="${z}"><input type="text" class="${inputFull} flatpickr-bom text-center" value="${DateUtils.formatDisplay(t.updateDate)}" ${roAttr} data-idx="${a}" data-field="updateDate" placeholder="-"></td>
                  <td class="${z}"><select class="${inputFull}" style="text-align-last:center" ${disAttr} onchange="updateBOMRow(${a},'applicant',this.value)">${r}</select></td>
                  <td class="${z}"><input type="text" class="${inputFull} text-center" value="${Utils.escapeHtml(t.unit)}" placeholder="單位" ${roAttr} onchange="updateBOMRow(${a},'unit',this.value)"></td>
                  <td class="${y}"><input type="text" class="${inputFull}" value="${Utils.escapeHtml(t.partNo)}" placeholder="料號" ${roAttr} onchange="updateBOMRow(${a},'partNo',this.value)"></td>
                  <td class="${z}">${stage ? `<span class="text-gray-700">${stage}</span>` : '<span class="text-gray-300">-</span>'}</td>
                  <td class="${z}"><select class="${inputFull}" style="text-align-last:center" ${disAttr} onchange="updateBOMRow(${a},'priority',this.value)">
                  <option value="" ${"" === t.priority || !t.priority ? "selected" : ""}></option>
                  <option value="1.一般" ${"1.一般" === t.priority ? "selected" : ""}>1.一般</option>
                  <option value="2.急件" ${"2.急件" === t.priority ? "selected" : ""}>2.急件</option>
                  <option value="3.特急" ${"3.特急" === t.priority ? "selected" : ""}>3.特急</option></select></td>
                  <td class="${z}"><input type="text" class="${inputFull} flatpickr-bom-done text-center${CancelInputModule.cancelClass(t.completeDate)}" value="${CancelInputModule.displayValue(t.completeDate)}" ${roAttr} data-idx="${a}" data-field="completeDate" placeholder="選擇日期"></td>
                  <td class="${y}"><select class="${inputFull}" style="text-align-last:center" ${disAttr} onchange="updateBOMRow(${a},'executor',this.value)">${generateMaintainerOptions(t.executor)}</select></td>
                  <td class="${z} bg-blue-50 border-blue-700/10 font-bold text-ms-blue align-top">${ isCancelled ? '<span class="text-gray-400 select-none">-</span>' : (workDays === "-" ? '<i class="fa-solid fa-calendar-clock text-sm text-gray-300"></i>' : workDays)}</td>
                  <td class="${z} bg-red-50 border-red-700/10 font-bold">${(() => {
                    const limit = OverdueModule.getThresholdPage17(t.priority);
                    const isOverdue = limit && typeof workDays === "number" && workDays > limit;
                    return isOverdue ? `<span class="text-red-500">${workDays - limit}</span>` : '<span class="text-gray-300">-</span>';
                  })()}</td>
                  <td class="${y} bg-red-50 border-red-700/10">${(() => {
                    const isOverdue = OverdueModule.isOverduePage17(t.priority, workDays);
                    const hasUpdateDate = !!t.updateDate;
                    if (!isOverdue && !hasUpdateDate) return '<div style="min-height:24px"></div>';
                    return `<textarea rows="1" class="${txtFull}" style="min-height:24px;field-sizing:content" placeholder="說明" ${roAttr} oninput="Utils.autoResize(this)" onchange="updateBOMRow(${a},'overdueNote',this.value)">${Utils.escapeHtml(t.overdueNote)}</textarea>`;
                  })()}</td>
                  </tr>`;
          })
          .join("");
        setTimeout(() => {
          t.querySelectorAll("textarea").forEach((e) => Utils.autoResize(e));
          if (null !== e) {
            let a = t.querySelector(".highlight-row");
            a && a.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 0);
        updateAuthUI();
        FlatpickrManager.init(".flatpickr-bom", (e, t) => {
            updateBOMRow(parseInt(e.dataset.idx), e.dataset.field, t);
        });
        CancelInputModule.setup(".flatpickr-bom-done", (e, t) => {
            updateBOMRow(parseInt(e.dataset.idx), e.dataset.field, t);
        });
      }

      function addBOMRow() {
        addGenericRow({
          dataArray: bomData,
          defaultRow: {
            receiveDate: "",
            updateDate: "",
            applicant: "",
            unit: "",
            partNo: "",
            priority: "",
            completeDate: "",
            executor: "",
            complexity: "",
            overdueNote: "",
          },
          paginationKey: "p17",
          renderFn: renderBOMPage,
          triggerPageId: 17,
          scrollSelector: "#page17 #bomScrollContainer .overflow-auto",
          dataType: "bom",
        });
      }
      function updateBOMRow(e, a, d) {
        updateGenericRow({
          dataArray: bomData,
          index: e,
          field: a,
          value: d,
          yearSelectId: "bomYearSelect",
          dateField: "completeDate",
          renderFn(e) {
            (renderBOMSidebar(), renderBOMTable(e));
          },
          triggerPageId: 17,
          dataType: "bom",
        });
      }


      /* ECR/ECN 追蹤 (Page 20) — 關卡名稱統一從 StepNameModule 取 */
      function formatSignInfo(info) {
        if (!info) return '';
        // [ \t]{2,} 只壓縮半形空格與 tab，避免吃掉換行與全形空格（保留 API 多行 + ↳ 縮排格式）
        return info.replace(/(?<!,)[\(（][^)）]*[\)）]+/g, '').replace(/[ \t]{2,}/g, ' ').trim().replace(/(?<!^)【/g, '\n【');
      }
      function extractStepShort(line) {
        const di = line.indexOf(' - ');
        const raw = (di > -1 ? line.substring(0, di) : line).trim();
        if (raw.startsWith("【七】協辦")) return "【七】協辦";
        if (raw.startsWith("【二】協辦")) return "【二】協辦";
        return StepNameModule.short(raw);
      }

      /* SyncTimeModule — 共用的 API 同步時間標籤 */
      const SyncTimeModule = {
        // 各頁面依賴的 API 名稱（會取所有 API 快取時間的最新一筆當顯示時間）
        pageMap: {
          1: ["ECRlist", "ECRstep", "ECNstep"],   // P1 ECN 詳細清單
          3: ["PCBstep"],                          // P3 PCB 詳細清單
          8: ["PCBstep"],                          // P8 GPMS 啟動清單
          10: ["ECRstep", "ECNstep"],              // P10 新人類轉單
          20: ["ECRlist", "ECRstep", "ECNstep"],   // P20 ECR/ECN 追蹤
        },
        // 取得最新一筆快取時間（多支 API 取最大值）
        getLatestTime(pageId) {
          const apis = this.pageMap[pageId];
          if (!apis) return null;
          const times = apis.map((a) => ApiModule.getCacheTime(a)).filter(Boolean);
          if (!times.length) return null;
          return new Date(Math.max(...times.map((t) => t.getTime())));
        },
        // 格式化為 YYYY-MM-DD hh:mm
        format(t) {
          if (!t) return "";
          const pad = (n) => String(n).padStart(2, "0");
          return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
        },
        // 更新指定頁面的時間標籤
        update(labelId, pageId) {
          const lbl = document.getElementById(labelId);
          if (!lbl) return;
          const t = this.getLatestTime(pageId);
          if (!t) {
            lbl.innerHTML = "";
            return;
          }
          lbl.innerHTML = `<span class="text-xs text-emerald-500 font-bold flex items-center gap-2 select-none" title="API 同步時間"><i class="fa-solid fa-cloud-arrow-down"></i><span>${this.format(t)}</span></span>`;
        },
      };

      /* API 同步函式工廠：lock + fetch + render；差異由 config 注入 */
      function createPageSync(config) {
        // config: { displayName, apis, overlayLoader?, onSuccess }
        let syncing = false;
        let overlayLoaded = false;
        return async function (forceRefresh = false, showStartToast = false) {
          if (syncing) return;
          syncing = true;
          try {
            const fetchFn = forceRefresh ? "refreshMany" : "fetchMany";
            const needLoadOverlay = !!config.overlayLoader && (!overlayLoaded || forceRefresh);
            const [, apiResult] = await Promise.all([
              needLoadOverlay ? config.overlayLoader().then(() => { overlayLoaded = true; }) : Promise.resolve(),
              ApiModule[fetchFn](config.apis),
            ]);
            await config.onSuccess(apiResult);
            // 全頁右上角時間
            lastSyncTime = new Date();
            updateSyncStatus("success", formatTime(lastSyncTime));
            if (showStartToast) ToastModule.show(`${config.displayName} 同步完成`, "success");
          } catch (e) {
            console.error(`[${config.displayName}] 同步失敗:`, e);
            ToastModule.show(`${config.displayName} 同步失敗：${e.message}。可改用「匯入」備援。`, "error");
          } finally {
            syncing = false;
          }
        };
      }

      // P1/P2/P10/P15/P20 共用：ECR/ECN 三支 API 一次到位
      const syncEcnFromAPI = createPageSync({
        displayName: "ECN",
        apis: ["ECRlist", "ECRstep", "ECNstep"],
        overlayLoader: loadOverlayFromGist,
        async onSuccess([ecrList, ecrSteps, ecnSteps]) {
          const newEcnRows = ApiAdapter.toEcnListRows(ecrList, ecnSteps);
          for (const r of newEcnRows) OverlayModule.applyEcn(r);
          ecnData = newEcnRows;
          trimInputsOnly(ecnData);
          ecnData.sort((a, b) => (b.id || "").localeCompare(a.id || ""));

          // Transfer 資料（P10）— Comment 直接用 API 值，不寫 GIST
          transferData = ApiAdapter.toTransferRows(ecrList, ecrSteps, ecnSteps);

          // P20 ECR/ECN 追蹤：用同一組 API 順手建好，省第二次撈
          const ecrEcnRows = ApiAdapter.toEcrEcnRows(ecrList, ecrSteps, ecnSteps);
          preprocessEcrEcnData(ecrEcnRows);
          ecrEcnData = ecrEcnRows;
          initEcrEcnYearSelect();

          // 重建年/月選單
          const ecnYears = [...new Set(ecnData.map((e) => e.month?.substring(0, 4)).filter(Boolean))].sort().reverse();
          Utils.initYearSelect("ecnYearSelect", ecnYears, "年", true);
          updateMonthSelect();

          // 切換到對應頁面才重渲染
          const activePage = document.querySelector(".page.active");
          if (activePage) {
            const pageId = parseInt(activePage.id.replace("page", ""));
            if (pageId === 1) renderTable();
            else if (pageId === 2) { renderCharts(); renderYearlyTable(); }
            else if (pageId === 10) renderTransferPage();
            else if (pageId === 20) { paginationState.p20 = 1; renderEcrEcnPage(); }
          }

          // 各頁面右上角同步時間標籤
          [["fileTime_p1", 1], ["fileTime_p10", 10], ["fileTime_p20", 20]].forEach(([id, pid]) => {
            SyncTimeModule.update(id, pid);
          });
          // P14 警示按鈕顯隱跟著 ECN 同步即時更新
          updateUndisabledBtnVisibility();
        },
      });

      /* P3 PCB 詳細清單：API 主檔 + GIST overlay（更新日/逾期說明） */
      async function loadPcbOverlayFromGist() {
        try {
          const { ID, PREFIX } = GIST_CONFIG.PCB;
          const r = await fetch(`${GITHUB_API_BASE}/gists/${ID}?t=${Date.now()}`, {
            headers: { Authorization: `token ${GITHUB_TOKEN}` },
          });
          if (!r.ok) return;
          const gist = await r.json();
          const files = await handleTruncatedFiles(gist.files);
          OverlayModule.loadPcbFromArray(YearlyModule.loadAndMerge(files, PREFIX.LIST, null));
          pcbStore.gpms = YearlyModule.loadAndMerge(files, PREFIX.GPMS, "date");
          pcbStore.maintain = YearlyModule.loadAndMerge(files, PREFIX.MAINTAIN, "date");
        } catch (e) {
          console.error("[loadPcbOverlayFromGist] 失敗", e);
        }
      }

      const syncPcbFromAPI = createPageSync({
        displayName: "PCB",
        apis: ["PCBstep"],
        overlayLoader: loadPcbOverlayFromGist,
        async onSuccess([pcbSteps]) {
          const newPcbRows = ApiAdapter.toPcbListRows(pcbSteps);
          for (const r of newPcbRows) OverlayModule.applyPcb(r);
          // overlay 套完後再算 KPI（updateDate 從 overlay 來）
          ApiAdapter.preprocessPcbListRows(newPcbRows);
          pcbStore.list = newPcbRows;
          isPCBLoaded = true;

          // P8 GPMS 啟動清單：有 id 是 API 列，沒 id 是 2025 之前的手填 legacy
          const newGpms = ApiAdapter.toGpmsRows(pcbSteps);
          const existingById = new Map();
          for (const row of (pcbStore.gpms || [])) {
            if (row && row.id) existingById.set(row.id, row);
          }
          for (const r of newGpms) {
            const ex = existingById.get(r.id);
            if (ex) {
              if (ex.note) r.note = ex.note;
              if (ex._override && typeof ex._override === "object") {
                Object.assign(r, ex._override);
                r._override = ex._override;
              }
            }
          }
          const manualRows = (pcbStore.gpms || []).filter((r) => r && !r.id);
          pcbStore.gpms = [...newGpms, ...manualRows];
          Utils.sortData(pcbStore.gpms, "date", false);

          // 重建年度選單
          const pcbYears = [...new Set(pcbStore.list.map((r) => (r.id || "").match(/-(\d{4})-/)?.[1]).filter(Boolean))].sort().reverse();
          Utils.initYearSelect("pcbYearSelect", pcbYears, "年", true);

          // 切換到對應頁面才重渲染
          const activePage = document.querySelector(".page.active");
          if (activePage) {
            const pageId = parseInt(activePage.id.replace("page", ""));
            if (pageId === 3) renderPCBKPITable();
            else if (pageId === 7) typeof renderPCBChart === "function" && renderPCBChart();
            else if (pageId === 8) renderGPMSPage();
            else if (pageId === 9) renderPCBMaintainPage();
          }

          SyncTimeModule.update("fileTime_p3", 3);
          SyncTimeModule.update("fileTime_p8", 8);
        },
      });

      function handleEcrEcnImport(input) {
        const file = input.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const json = JSON.parse(e.target.result);
            let newData;
            if (Array.isArray(json)) newData = json;
            else if (json.tableRows) newData = json.tableRows;
            else if (json.rows) newData = json.rows;
            else { ToastModule.show('JSON 格式不正確', 'warning'); return; }
            const ns = v => (v || '').trim();
            const oldMap = new Map(ecrEcnData.map(r => [r.ecrSerial + '|' + (r.ecnSerial || ''), r]));
            const CMP_FIELDS = [
              'ecrStatusText','ecrApplyTime','ecrStep7Time','ecrApplicant','ecrApplicantDept','ecrSignInfo',
              'ecnSerial','ecnStatusText','ecnApplyTime','ecnStep2Time','ecnApplicant','ecnApplicantDept','ecnSignInfo'
            ];
            let added = 0, updated = 0, unchanged = 0;

            preprocessEcrEcnData(newData);

            for (const r of newData) {
              const key = r.ecrSerial + '|' + (r.ecnSerial || '');
              if (!r.ecrSerial) continue;
              const ex = oldMap.get(key);
              if (ex) {
                const changed = CMP_FIELDS.some(f => ns(ex[f]) !== ns(r[f]));
                if (changed) {
                  r._dirty = true;
                  oldMap.set(key, r);
                  YearlyModule.markDirtyFromRecord('ecrecn', r);
                  updated++;
                } else {
                  oldMap.set(key, { ...ex });
                  unchanged++;
                }
              } else {
                r._dirty = true;
                oldMap.set(key, r);
                YearlyModule.markDirtyFromRecord('ecrecn', r);
                added++;
              }
            }
            // 清理：若某張 ECR 已有真正的 ECN，移除其佔位記錄（(無ECN)/(ECR尚未結案)/不執行ECN/空值，視為更新）
            const ecrWithRealEcn = new Set();
            for (const r of oldMap.values()) {
              if (!ApiAdapter.isEcnPlaceholder(r.ecnSerial)) {
                ecrWithRealEcn.add(r.ecrSerial);
              }
            }
            for (const [k, r] of oldMap) {
              if (ApiAdapter.isEcnPlaceholder(r.ecnSerial) && ecrWithRealEcn.has(r.ecrSerial)) {
                oldMap.delete(k);
                if (unchanged > 0) { unchanged--; } else { added = Math.max(0, added - 1); }
                updated++;
              }
            }
            ecrEcnData = Array.from(oldMap.values());
            ecrEcnData.sort((a, b) => (b.ecrSerial || "").localeCompare(a.ecrSerial || ""));
            initEcrEcnYearSelect();
            if (added || updated) triggerChange(20);
            ToastModule.show(`匯入完成：共 ${newData.length} 筆（新增 ${added}、更新 ${updated}）`, 'success');
            paginationState.p20 = 1;
            renderEcrEcnPage();
            updateSaveButtonStatus();
          } catch (err) { ToastModule.show('JSON 解析失敗: ' + err.message, 'error'); }
        };
        reader.readAsText(file); input.value = '';
      }
 
      function shortenDeptName(raw) {
        if (!raw) return '';
        const s = raw.trim();
        if (s.includes('/')) return s.split('/')[0];
        const m = s.match(/^[A-Za-z0-9\-]+/);
        return m ? m[0] : s;
      }

      function preprocessEcrEcnData(arr = ecrEcnData) {
        for (const r of arr) {
          r.ecrApplyTime = DateUtils.formatDisplay(r.ecrApplyTime) || '';
          r.ecrStep7Time = DateUtils.formatDisplay(r.ecrStep7Time) || '';
          r.ecnApplyTime = DateUtils.formatDisplay(r.ecnApplyTime) || '';
          r.ecnStep2Time = DateUtils.formatDisplay(r.ecnStep2Time) || '';
          const ed = DateUtils.calcWorkDays(r.ecrApplyTime, r.ecrStep7Time);
          r.ecrDuration = (ed !== '-' && ed > 0) ? String(ed) : '';
          const nd = DateUtils.calcWorkDays(r.ecnApplyTime, r.ecnStep2Time);
          r.ecnDuration = (nd !== '-' && nd > 0) ? String(nd) : '';
          r.ecrSignInfo = formatSignInfo(r.ecrSignInfo || '');
          r.ecnSignInfo = formatSignInfo(r.ecnSignInfo || '');
          r.ecrApplicant = extractEngName(r.ecrApplicant) || r.ecrApplicant || '';
          r.ecnApplicant = r.ecnApplicant ? extractEngName(r.ecnApplicant) : '';
          r.ecrApplicantDept = shortenDeptName(r.ecrApplicantDept);
          r.ecnApplicantDept = shortenDeptName(r.ecnApplicantDept);
        }
      }
 
      function initEcrEcnYearSelect() {
        const years = new Set();
        for (const r of ecrEcnData) {
            const y1 = DateUtils.normalizeYear(r.ecrApplyTime);
            const y2 = DateUtils.normalizeYear(r.ecnApplyTime);
            if (y1) years.add(y1);
            if (y2) years.add(y2);
        }
        Utils.initYearSelect('ecrEcnYearSelect', [...years], '年', true);
    }
      function getEcrEcnFilteredByYear(input) {
      const data = input || ecrEcnData;
      const y = getSelectedYear('ecrEcnYearSelect');
      if (!y) return data;
      return data.filter(r =>
          DateUtils.normalizeYear(r.ecrApplyTime) === y ||
          DateUtils.normalizeYear(r.ecnApplyTime) === y
      );
  }
 
      function getWeekRange(d) {
        const date = new Date(d), day = date.getDay();
        const mon = new Date(date); mon.setDate(date.getDate() - (day === 0 ? 6 : day - 1)); mon.setHours(0,0,0,0);
        const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999);
        return { start: mon, end: sun };
      }
      function getMonthRange(y, m) { return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0, 23, 59, 59, 999) }; }
 
      // 總覽卡
      function summaryCard(title, total, segments, titleColor) {
        const legend = segments.map(s =>
          `<span class="flex items-center gap-1"><span class="w-2 h-2 ${s.bg} rounded-full"></span>${s.label} <b>${s.count}</b></span>`
        ).join('');
        const bar = segments.filter(s => s.count > 0 && total > 0).map(s =>
          `<div class="h-full ${s.bg}" style="width:${(s.count/total*100).toFixed(1)}%"></div>`
        ).join('');
        return `<div class="relative rounded-xl p-4 shadow-md border border-gray-200 flex flex-col justify-between h-36 col-span-2 bg-white">
          <div><div class="text-sm font-bold ${titleColor} tracking-wide">${title}</div>
          <div class="text-4xl font-black text-gray-800 mt-1">${total}</div></div>
          <div class="mt-auto"><div class="flex flex-wrap gap-x-3 gap-y-1 mb-1.5 font-bold text-[11px] text-gray-500">${legend}</div>
          <div class="flex overflow-hidden w-full h-2.5 bg-gray-100 rounded-full shadow-inner">${bar}</div></div></div>`;
      }
 
      // 小卡
      function miniCard(val, label, bg, textMain, textLabel, unit, sub) {
        return `<div class="rounded-xl p-4 shadow-md border border-gray-200 flex flex-col justify-between h-36 ${bg}">
          <div><div class="text-xs font-bold ${textLabel} tracking-wide">${label}</div>
          <div class="text-3xl font-black ${textMain} mt-1">${val}<span class="font-normal text-xs opacity-60">${unit||''}</span></div></div>
          ${sub?`<div class="mt-auto text-xs ${textLabel} opacity-80">${sub}</div>`:''}</div>`;
      }
 
      // 趨勢
      function trendMiniCard(label, thisA, lastA, bg, textMain, textLabel, lastColor) {
        const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
        const ta = avg(thisA), la = avg(lastA);
        let val, left, right;
        if (ta === null && la === null) {
          val = 'N/A'; left = '無資料 (0筆 : 0筆)'; right = '';
        } else if (ta === null) {
          val = '0'; left = `無本期 (0筆 : ${lastA.length}筆)`; right = la !== null ? `<span class="${lastColor}">上期均 ${la.toFixed(1)}天` : '';
        } else if (la === null) {
          val = ta.toFixed(1); left = `無上期 (${thisA.length}筆 : 0筆)`; right = '';
        } else {
          val = ta.toFixed(1); const diff = ta - la;
          if (Math.abs(diff) < 0.05) {
            left = `<span class="text-gray-500"><i class="fa-solid fa-minus"></i> 0天</span> (${thisA.length}筆 : ${lastA.length}筆)`;
          } else if (diff < 0) {
            left = `<span class="text-emerald-700 font-bold"><i class="fa-solid fa-arrow-down"></i> ${Math.abs(diff).toFixed(1)}天</span> (${thisA.length}筆 : ${lastA.length}筆)`;
          } else {
            left = `<span class="text-red-600 font-bold"><i class="fa-solid fa-arrow-up"></i> ${diff.toFixed(1)}天</span> (${thisA.length}筆 : ${lastA.length}筆)`;
          }
          right = `<span class="${lastColor}">上期均 ${la.toFixed(1)}天</span>`;
        }
        const sub = `<div class="flex justify-between items-center"><span>${left}</span>${right ? `<span>${right}</span>` : ''}</div>`;
        return miniCard(val, label, bg, textMain, textLabel, val === 'N/A' ? '' : ' 天', sub);
    }

      // 趨勢比較子文字（供 _monthTrendCard 使用）
      function trendMiniCardSub(thisA, lastA, lastColor) {
        const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
        const ta = avg(thisA), la = avg(lastA);
        let left, right = '';
        if (ta === null && la === null) {
          left = '無資料 (0筆 : 0筆)';
        } else if (ta === null) {
          left = `無本期 (0筆 : ${lastA.length}筆)`; right = la !== null ? `<span class="${lastColor}">上期均 ${la.toFixed(1)}天</span>` : '';
        } else if (la === null) {
          left = `無上期 (${thisA.length}筆 : 0筆)`;
        } else {
          const diff = ta - la;
          if (Math.abs(diff) < 0.05) {
            left = `<span class="text-gray-500"><i class="fa-solid fa-minus"></i> 0天</span> (${thisA.length}筆 : ${lastA.length}筆)`;
          } else if (diff < 0) {
            left = `<span class="text-emerald-700 font-bold"><i class="fa-solid fa-arrow-down"></i> ${Math.abs(diff).toFixed(1)}天</span> (${thisA.length}筆 : ${lastA.length}筆)`;
          } else {
            left = `<span class="text-red-600 font-bold"><i class="fa-solid fa-arrow-up"></i> ${diff.toFixed(1)}天</span> (${thisA.length}筆 : ${lastA.length}筆)`;
          }
          right = `<span class="${lastColor}">上期均 ${la.toFixed(1)}天</span>`;
        }
        return `<div class="flex justify-between items-center"><span>${left}</span>${right ? `<span>${right}</span>` : ''}</div>`;
      }

      /* ---- ECR/ECN 月均趨勢 Area Chart ---- */
      let _ecrAreaChart = null, _ecnAreaChart = null;
      let _ecrSelectedMonth = null, _ecnSelectedMonth = null;
      let _ecrTrendView = false, _ecnTrendView = false;

      function _toggleTrendView(type) {
        if (type === 'ecr') _ecrTrendView = !_ecrTrendView;
        else _ecnTrendView = !_ecnTrendView;
        renderEcrEcnPage();
      }

      // 本月均卡片（含切換趨勢圖按鈕）
      function _monthTrendCard(val, label, bg, textMain, textLabel, unit, sub, type, showChart) {
        const btnColor = type === 'ecr' ? 'text-orange-400 hover:text-orange-600' : 'text-blue-400 hover:text-blue-600';
        const btnHtml = showChart ? `<button class="text-sm ${btnColor} transition-colors" onclick="_toggleTrendView('${type}')" title="切換趨勢圖"><i class="fa-solid fa-chart-line"></i></button>` : '';
        return `<div class="rounded-xl p-4 shadow-md border border-gray-200 flex flex-col justify-between h-36 ${bg}">
          <div class="flex items-center justify-between">
            <div class="text-xs font-bold ${textLabel} tracking-wide">${label}</div>
            ${btnHtml}
          </div>
          <div class="text-3xl font-black ${textMain} mt-1">${val}<span class="font-normal text-xs opacity-60">${unit||''}</span></div>
          ${sub?`<div class="mt-auto text-xs ${textLabel} opacity-80">${sub}</div>`:''}</div>`;
      }

      // 趨勢圖卡片（含切換按鈕）
      function _areaChartCard(canvasId, type) {
        const color = type === 'ecr' ? 'orange' : 'blue';
        return `<div class="rounded-xl p-4 shadow-md border border-gray-200 flex flex-col h-36 bg-white">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs font-bold text-${color}-600 tracking-wide" id="${canvasId}_title">月均趨勢</span>
            <div class="flex items-center gap-1">
              <span class="text-[10px] text-gray-400" id="${canvasId}_sub"></span>
              <button class="ml-1 text-sm text-${color}-400 hover:text-${color}-600 transition-colors" onclick="_toggleTrendView('${type}')" title="切換指標卡"><i class="fa-solid fa-grid-2"></i></button>
            </div>
          </div>
          <div class="flex-1 relative" style="min-height:0"><canvas id="${canvasId}"></canvas></div>
        </div>`;
      }

      function _buildMonthlyAvg(compItems, year) {
        // compItems: [{d: Date, dur: number}]
        const byMonth = {};
        for (let m = 1; m <= 12; m++) byMonth[m] = [];
        compItems.forEach(i => {
          if (!i.d) return;
          const y = i.d.getFullYear().toString();
          if (year && y !== year) return;
          byMonth[i.d.getMonth() + 1].push(i.dur);
        });
        const labels = [], data = [], counts = [];
        for (let m = 1; m <= 12; m++) {
          labels.push(`${m}月`);
          const arr = byMonth[m];
          data.push(arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null);
          counts.push(arr.length);
        }
        return { labels, data, counts };
      }

      function _buildWeeklyAvg(compItems, year, month) {
        // month: 1-based
        if (!year || !month) return { labels: [], tooltipLabels: [], data: [], counts: [] };
        const y = parseInt(year), m = month - 1;
        const firstDay = new Date(y, m, 1);
        const lastDay = new Date(y, m + 1, 0);
        const weeks = [];
        let wStart = new Date(firstDay);
        // align to Monday
        const day = wStart.getDay();
        if (day !== 1) wStart.setDate(wStart.getDate() - (day === 0 ? 6 : day - 1));
        while (wStart <= lastDay) {
          const wEnd = new Date(wStart);
          wEnd.setDate(wStart.getDate() + 6);
          wEnd.setHours(23, 59, 59, 999);
          weeks.push({ start: new Date(wStart), end: wEnd });
          wStart.setDate(wStart.getDate() + 7);
        }
        const labels = [], tooltipLabels = [], data = [], counts = [];
        let wNum = 0;
        weeks.forEach((w) => {
          const fmtD = d => `${d.getMonth()+1}/${d.getDate()}`;
          const rangeStr = `${fmtD(w.start)} ~ ${fmtD(w.end)}`;
          if (w.start.getMonth() !== m) return;
          const tag = `W${++wNum}`;
          labels.push(tag);
          tooltipLabels.push(`${tag}  ${rangeStr}`);
          const arr = compItems.filter(item => item.d >= w.start && item.d <= w.end).map(item => item.dur);
          data.push(arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null);
          counts.push(arr.length);
        });
        return { labels, tooltipLabels, data, counts };
      }

      function _renderAreaChart(canvasId, monthlyData, weeklyData, compItems, year, type) {
        const isEcr = type === 'ecr';
        const borderColor = isEcr ? '#ea580c' : '#2563eb';
        const pointColor = isEcr ? '#f97316' : '#3b82f6';
        const bgFrom = isEcr ? 'rgba(251,146,60,0.25)' : 'rgba(96,165,250,0.25)';
        const bgTo = 'rgba(255,255,255,0)';
        const selectedMonth = isEcr ? _ecrSelectedMonth : _ecnSelectedMonth;

        // Determine which dataset to show
        const isWeekView = selectedMonth !== null;
        const ds = isWeekView ? weeklyData : monthlyData;

        const titleEl = document.getElementById(`${canvasId}_title`);
        const subEl = document.getElementById(`${canvasId}_sub`);
        if (titleEl) titleEl.textContent = isWeekView ? `${selectedMonth}月 周均趨勢` : '月均趨勢';
        if (subEl) subEl.innerHTML = isWeekView
          ? `<span class="cursor-pointer hover:text-gray-600" onclick="_resetAreaChart('${type}')"><i class="fa-solid fa-arrow-left mr-1"></i>返回月均</span>`
          : (year ? `${year} 年` : '全年度');

        // Destroy old
        const chartRef = isEcr ? _ecrAreaChart : _ecnAreaChart;
        if (chartRef) { chartRef.destroy(); }

        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.parentElement.clientHeight || 80);
        gradient.addColorStop(0, bgFrom);
        gradient.addColorStop(1, bgTo);

        const chart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: ds.labels,
            datasets: [{
              data: ds.data,
              borderColor: borderColor,
              backgroundColor: gradient,
              borderWidth: 2,
              pointRadius: 3,
              pointBackgroundColor: pointColor,
              pointHoverRadius: 6,
              pointHoverBackgroundColor: '#fff',
              pointHoverBorderWidth: 2,
              pointHoverBorderColor: borderColor,
              fill: true,
              tension: 0.3,
              spanGaps: true,
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { left: 0, right: 4, top: 4, bottom: 0 } },
            scales: {
              x: {
                grid: { display: false },
                ticks: { font: { size: 9 }, color: '#9ca3af', maxRotation: 0 },
                border: { display: false },
              },
              y: {
                grid: { color: '#f3f4f6', drawBorder: false },
                ticks: { font: { size: 9 }, color: '#9ca3af', precision: 0 },
                border: { display: false },
                beginAtZero: true,
              }
            },
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: 'rgba(0,0,0,0.8)',
                titleFont: { size: 11 },
                bodyFont: { size: 11 },
                padding: 8,
                cornerRadius: 6,
                callbacks: {
                  title: (items) => {
                    const idx = items[0]?.dataIndex;
                    if (idx == null) return '';
                    if (isWeekView && ds.tooltipLabels) return ds.tooltipLabels[idx];
                    return ds.labels[idx];
                  },
                  label: (ctx) => {
                    const idx = ctx.dataIndex;
                    const val = ds.data[idx];
                    const cnt = ds.counts[idx];
                    return val !== null && cnt > 0 ? `平均 ${val} 天 (${cnt} 筆)` : '無資料 (0 筆)';
                  }
                }
              },
              datalabels: { display: false },
            },
            onClick: (evt, elements) => {
              if (isWeekView || !elements.length) return;
              const idx = elements[0].index;
              if (isEcr) { _ecrSelectedMonth = idx + 1; } else { _ecnSelectedMonth = idx + 1; }
              const wd = _buildWeeklyAvg(compItems, year, idx + 1);
              _renderAreaChart(canvasId, monthlyData, wd, compItems, year, type);
            },
            onHover: (evt, elements) => {
              canvas.style.cursor = (!isWeekView && elements.length) ? 'pointer' : 'default';
            },
          },
          plugins: [ChartDataLabels],
        });

        if (isEcr) _ecrAreaChart = chart; else _ecnAreaChart = chart;
      }

      function _resetAreaChart(type) {
        if (type === 'ecr') _ecrSelectedMonth = null; else _ecnSelectedMonth = null;
        renderEcrEcnPage();
      }

      /* P20 主渲染 */
      function renderEcrEcnPage() {
        if (!ecrEcnData.length) {
          document.getElementById('ecrStatCards').innerHTML = '<div class="col-span-5 text-center text-gray-400 py-6"><i class="fa-solid fa-cloud-arrow-down text-3xl mb-2 block"></i>正在從 BPM API 同步資料...</div>';
          document.getElementById('ecnStatCards').innerHTML = '';
          document.getElementById('ecrEcnTbody').innerHTML = '';
          document.getElementById('ecrEcnCount').textContent = '';
          document.getElementById('pagination_p20').innerHTML = '';
          return;
        }
        SyncTimeModule.update("fileTime_p20", 20);

        const rows = getEcrEcnFilteredByYear(), now = new Date();
        const tw = getWeekRange(now), lw = getWeekRange(new Date(now.getTime()-7*864e5));
        const tm = getMonthRange(now.getFullYear(), now.getMonth());
        const pm = now.getMonth()===0 ? getMonthRange(now.getFullYear()-1,11) : getMonthRange(now.getFullYear(),now.getMonth()-1);
        const fmtD = d => `${d.getMonth()+1}/${d.getDate()}`;
        const twLabel = `${fmtD(tw.start)} - ${fmtD(tw.end)}`, tmLabel = `${fmtD(tm.start)} - ${fmtD(tm.end)}`;
        const inR = (items, range) => items.filter(i=>i.d>=range.start&&i.d<=range.end).map(i=>i.dur);
 
        // ECR（橘）
        const selYear = getSelectedYear('ecrEcnYearSelect');
        const ecrM={}; for(const r of rows){
            if(r.ecrSerial&&r.ecrSerial!=='(無ECR)'&&!ecrM[r.ecrSerial]){
                if(!selYear || DateUtils.normalizeYear(r.ecrApplyTime)===selYear) ecrM[r.ecrSerial]=r;
            }
        } const ecrU=Object.values(ecrM);
        const ecrTotal=ecrU.length, ecrClosed=ecrU.filter(r=>r.ecrStatusText==='同意結束'||r.ecrStatusText==='結案').length;
        const ecrIP=ecrU.filter(r=>r.ecrStatusText==='進行中').length;
        const ecrRW=ecrU.filter(r=>['駁回結束','表單撤回'].includes(r.ecrStatusText)).length;
        const ecrDays=ecrU.filter(r=>r.ecrDuration).map(r=>parseFloat(r.ecrDuration));
        const ecrAvg=ecrDays.length?(ecrDays.reduce((a,b)=>a+b,0)/ecrDays.length).toFixed(1):'N/A';
        const ecrComp=ecrU.filter(r=>(r.ecrStatusText==='同意結束'||r.ecrStatusText==='結案')&&r.ecrStep7Time&&r.ecrDuration)
          .map(r=>({d:DateUtils.parse(r.ecrStep7Time),dur:parseFloat(r.ecrDuration)})).filter(i=>i.d);

        // ECR 周均：若有選定月份則顯示該月周均，否則顯示本周
        const ecrWkLabel = '本周均 <span class="font-normal text-gray-400 text-[9px]">' + twLabel + '</span>';
        const ecrWkThis = inR(ecrComp, tw);
        const ecrWkLast = inR(ecrComp, lw);

        document.getElementById('ecrStatCards').innerHTML =
          summaryCard('ECR 總覽',ecrTotal,[
            {label:'同意結束',count:ecrClosed,bg:'bg-orange-600'},{label:'進行中',count:ecrIP,bg:'bg-amber-400'},
            {label:'駁回/撤回',count:ecrRW,bg:'bg-red-400'}],'text-orange-700') +
          miniCard(ecrAvg,'總平均','bg-orange-50','text-orange-800','text-orange-600',' 天','申請 <i class="fa-solid fa-right-long"></i> 第七關') +
          trendMiniCard(ecrWkLabel, ecrWkThis, ecrWkLast, 'bg-amber-50', 'text-amber-800', 'text-amber-600', 'text-amber-600') +
          (_ecrTrendView
            ? _areaChartCard('ecrAreaChart', 'ecr')
            : _monthTrendCard(
                inR(ecrComp,tm).length ? (inR(ecrComp,tm).reduce((a,b)=>a+b,0)/inR(ecrComp,tm).length).toFixed(1) : 'N/A',
                '本月均 <span class="font-normal text-gray-400 text-[9px]">' + tmLabel + '</span>',
                'bg-orange-100','text-orange-900','text-orange-700',' 天',
                trendMiniCardSub(inR(ecrComp,tm), inR(ecrComp,pm), 'text-orange-700'),
                'ecr', !!selYear));

        // ECR Area Chart 渲染（僅趨勢模式）
        if (_ecrTrendView) {
          const ecrMonthly = _buildMonthlyAvg(ecrComp, selYear);
          const ecrWeekly = _ecrSelectedMonth ? _buildWeeklyAvg(ecrComp, selYear, _ecrSelectedMonth) : { labels: [], tooltipLabels: [], data: [], counts: [] };
          _renderAreaChart('ecrAreaChart', ecrMonthly, ecrWeekly, ecrComp, selYear, 'ecr');
        }
 
        // ECN（藍）
        const ecnR=rows.filter(r=>!ApiAdapter.isEcnPlaceholder(r.ecnSerial)&&(!selYear||DateUtils.normalizeYear(r.ecnApplyTime)===selYear));
        const ecnTotal=ecnR.length, ecnClosed=ecnR.filter(r=>r.ecnStatusText==='同意結束'||r.ecnStatusText==='結案').length;
        const ecnExec=Math.max(0,ecnR.filter(r=>r.ecnStep2Time).length-ecnClosed);
        const ecnRW=ecnR.filter(r=>['駁回結束','表單撤回'].includes(r.ecnStatusText)).length;
        const ecnOther=Math.max(0,ecnTotal-ecnClosed-ecnExec-ecnRW);
        const ecnDays=ecnR.filter(r=>r.ecnDuration).map(r=>parseFloat(r.ecnDuration));
        const ecnAvg=ecnDays.length?(ecnDays.reduce((a,b)=>a+b,0)/ecnDays.length).toFixed(1):'N/A';
        const ecnComp=ecnR.filter(r=>r.ecnStep2Time&&r.ecnDuration).map(r=>({d:DateUtils.parse(r.ecnStep2Time),dur:parseFloat(r.ecnDuration)})).filter(i=>i.d);

        // ECN 周均：若有選定月份則顯示該月周均，否則顯示本周
        const ecnWkLabel = '本周均 <span class="font-normal text-gray-400 text-[9px]">' + twLabel + '</span>';
        const ecnWkThis = inR(ecnComp, tw);
        const ecnWkLast = inR(ecnComp, lw);

        document.getElementById('ecnStatCards').innerHTML =
          summaryCard('ECN 總覽',ecnTotal,[
            {label:'同意結束',count:ecnClosed,bg:'bg-indigo-600'},{label:'已執行',count:ecnExec,bg:'bg-sky-400'},
            {label:'進行中',count:ecnOther,bg:'bg-gray-300'},{label:'駁回/撤回',count:ecnRW,bg:'bg-red-400'}],'text-blue-700') +
          miniCard(ecnAvg,'總平均','bg-blue-50','text-blue-800','text-blue-600',' 天','申請 <i class="fa-solid fa-right-long"></i> 第二關') +
          trendMiniCard(ecnWkLabel, ecnWkThis, ecnWkLast, 'bg-sky-50', 'text-sky-800', 'text-sky-600', 'text-sky-600') +
          (_ecnTrendView
            ? _areaChartCard('ecnAreaChart', 'ecn')
            : _monthTrendCard(
                inR(ecnComp,tm).length ? (inR(ecnComp,tm).reduce((a,b)=>a+b,0)/inR(ecnComp,tm).length).toFixed(1) : 'N/A',
                '本月均 <span class="font-normal text-gray-400 text-[9px]">' + tmLabel + '</span>',
                'bg-indigo-100','text-indigo-900','text-indigo-700',' 天',
                trendMiniCardSub(inR(ecnComp,tm), inR(ecnComp,pm), 'text-indigo-700'),
                'ecn', !!selYear));

        // ECN Area Chart 渲染（僅趨勢模式）
        if (_ecnTrendView) {
          const ecnMonthly = _buildMonthlyAvg(ecnComp, selYear);
          const ecnWeekly = _ecnSelectedMonth ? _buildWeeklyAvg(ecnComp, selYear, _ecnSelectedMonth) : { labels: [], tooltipLabels: [], data: [], counts: [] };
          _renderAreaChart('ecnAreaChart', ecnMonthly, ecnWeekly, ecnComp, selYear, 'ecn');
        }
 
        // 表格
        const kw=(document.getElementById('searchBox_p20')?.value||'').trim();
        let filtered=rows; if(kw) filtered=SearchModule.filterData(filtered,'p20',kw);
        renderPaginationControls('pagination_p20','p20',filtered.length,'renderEcrEcnTable');
        const pd=getPaginatedData(filtered,'p20');
        let html='';
        const z = "p-2 border-b text-center";
        for(const r of pd){
          const isNo=ApiAdapter.isEcnPlaceholder(r.ecnSerial);
          const isGrayEcn=!r.ecnSerial||r.ecnSerial==='(無ECN)'||r.ecnSerial==='(ECR尚未結案)';
          const eB=getBadgeClass(r.ecrStatusText), nB=isNo?'':getBadgeClass(r.ecnStatusText);
          const eSH=(r.ecrSignInfo||'').split('\n').filter(Boolean).map(l=>`<div class="leading-5">${Utils.escapeHtml(l)}</div>`).join('');
          const nSH=(r.ecnSignInfo||'').split('\n').filter(Boolean).map(l=>`<div class="leading-5">${Utils.escapeHtml(l)}</div>`).join('');
          html+=`<tr class="hover:bg-gray-50 transition-colors">
            <td class="${z} font-bold text-orange-600">${Utils.escapeHtml(r.ecrSerial)}</td>
            <td class="${z}"><span class="${eB}">${Utils.escapeHtml(r.ecrStatusText)}</span></td>
            <td class="${z}">${Utils.escapeHtml(r.ecrApplyTime)}</td>
            <td class="${z}">${Utils.escapeHtml(r.ecrApplicantDept||'')}</td>
            <td class="${z}">${Utils.escapeHtml(r.ecrApplicant)}</td>
            <td class="p-2 border-b text-gray-600" style="white-space:normal;">${eSH}</td>
            <td class="${z}">${Utils.escapeHtml(r.ecrStep7Time)}</td>
            <td class="${z} border-orange-700/10 bg-orange-50 font-bold ${r.ecrDuration?'text-orange-600':''}" style="border-right:1px solid #d1d5db;">${r.ecrDuration||''}</td>
            <td class="${z} font-bold ${isGrayEcn?'text-gray-300':'text-ms-blue'}">${Utils.escapeHtml(r.ecnSerial)}</td>
            <td class="${z}">${isNo?'':`<span class="${nB}">${Utils.escapeHtml(r.ecnStatusText||'')}</span>`}</td>
            <td class="${z}">${isNo?'':Utils.escapeHtml(r.ecnApplyTime)}</td>
            <td class="${z}">${isNo?'':Utils.escapeHtml(r.ecnApplicantDept||'')}</td>
            <td class="${z}">${isNo?'':Utils.escapeHtml(r.ecnApplicant)}</td>
            <td class="p-2 border-b text-gray-600" style="white-space:normal;">${isNo?'':nSH}</td>
            <td class="${z}">${isNo?'':Utils.escapeHtml(r.ecnStep2Time)}</td>
            <td class="${z} border-blue-700/10 bg-blue-50 font-bold ${r.ecnDuration?'text-ms-blue':''}">${isNo?'':(r.ecnDuration||'')}</td>
          </tr>`;
        }
        document.getElementById('ecrEcnTbody').innerHTML=html||'<tr><td colspan="16" class="p-8 text-center text-gray-400">無符合條件的資料</td></tr>';
        document.getElementById('ecrEcnCount').textContent=`顯示 ${filtered.length} / ${ecrEcnData.length} 筆`;
      }
      function renderEcrEcnTable(){renderEcrEcnPage();}

      // === P20 月報摘要 ===
      // 入口：showMonthlyReportModal / renderMonthlyReport / copyMonthlyReportSummary / copyMonthlyReportDetail
      function _mrPct(n, d) { return d ? Math.round(n / d * 100) : 0; }
      function _mrAvg(arr) {
        if (!arr.length) return null;
        return arr.reduce((a,b)=>a+b,0) / arr.length;
      }
      function _mrFmt(n, digits) {
        if (n === null || n === undefined || isNaN(n)) return 'N/A';
        return Number(n).toFixed(digits === undefined ? 2 : digits);
      }
      function _mrParseYM(ym) {
        const [y, m] = ym.split('-').map(Number);
        return { y, m };
      }
      function _mrMonthRange(ym) {
        const { y, m } = _mrParseYM(ym);
        return { start: new Date(y, m-1, 1, 0,0,0,0), end: new Date(y, m, 0, 23,59,59,999) };
      }
      function _mrPrevMonth(ym) {
        const { y, m } = _mrParseYM(ym);
        const d = new Date(y, m-2, 1);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      }
      function _mrNow() {
        const n = new Date();
        return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;
      }
      function _mrMonthDiff(fromYM, toYM) {
        const a = _mrParseYM(fromYM), b = _mrParseYM(toYM);
        return (b.y - a.y) * 12 + (b.m - a.m);
      }
      function _mrCloseYM(dateStr) {
        const d = DateUtils.parse(dateStr);
        if (!d) return null;
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      }

      /* 建立月份下拉：抓所有出現過的結案月份 + 本月 */
      function _mrBuildOptions() {
        const set = new Set();
        for (const r of ecrEcnData) {
          const a = _mrCloseYM(r.ecrStep7Time); if (a) set.add(a);
          const b = _mrCloseYM(r.ecnStep2Time); if (b) set.add(b);
        }
        set.add(_mrNow());
        return [...set].sort().reverse().map(ym => {
          const [y, m] = ym.split('-');
          return { value: ym, label: `${y} 年 ${parseInt(m)} 月` };
        });
      }

      /* 取「上一個完整月」；若當月為 1 月則回上一年 12 月 */
      function _mrDefaultMonth() {
        const now = new Date();
        const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      }

      /* 收集去重後的 ECR / ECN 清單（不含 placeholder） */
      function _mrCollectUnique() {
        const ecrMap = {}, ecnMap = {};
        for (const r of ecrEcnData) {
          if (r.ecrSerial && r.ecrSerial !== '(無ECR)' && !ecrMap[r.ecrSerial]) ecrMap[r.ecrSerial] = r;
          if (r.ecnSerial && !ApiAdapter.isEcnPlaceholder(r.ecnSerial) && !ecnMap[r.ecnSerial]) ecnMap[r.ecnSerial] = r;
        }
        return { ecrs: Object.values(ecrMap), ecns: Object.values(ecnMap) };
      }

      /* 篩本月結案（ECR：ecrStep7Time；ECN：ecnStep2Time） */
      function _mrFilterClosed(list, dateField, range) {
        return list.filter(r => {
          if (!r[dateField]) return false;
          const d = DateUtils.parse(r[dateField]);
          return d && d >= range.start && d <= range.end;
        });
      }

      /* 拆 bucket：非目標年→按年；目標年→按月 */
      function _mrBuildBuckets(closed, applyField, durField, targetYM) {
        const { y: ty } = _mrParseYM(targetYM);
        const yearG = {}, monthG = {};
        for (const r of closed) {
          const d = DateUtils.parse(r[applyField]); if (!d) continue;
          const dur = parseFloat(r[durField]); if (isNaN(dur) || dur <= 0) continue;
          const yy = d.getFullYear();
          (yearG[yy] = yearG[yy] || []).push(dur);
          if (yy === ty) {
            const mm = d.getMonth() + 1;
            (monthG[mm] = monthG[mm] || []).push(dur);
          }
        }
        const yearBuckets = Object.keys(yearG).map(Number).sort().map(yy => ({
          key: `y${yy}`, label: `${yy} 年`, count: yearG[yy].length, avg: _mrAvg(yearG[yy]),
        }));
        const monthBuckets = Object.keys(monthG).map(Number).sort((a,b)=>a-b).map(mm => ({
          key: `m${mm}`, label: `${mm} 月`, count: monthG[mm].length, avg: _mrAvg(monthG[mm]),
        }));
        return { yearBuckets, monthBuckets };
      }

      /* impact = 占比 × 偏差；signFilter: 'pos'|'neg'|其他=全部；排除 pct<minPct，依 |impact| 取 topN，最後依 % 排序 */
      function _mrTopImpact(buckets, overallAvg, totalCount, topN, minPct, signFilter) {
        if (overallAvg === null || !totalCount) return [];
        return buckets.map(b => ({
            ...b,
            dev: b.avg - overallAvg,
            impact: b.count * (b.avg - overallAvg) / totalCount,
          }))
          .filter(b => b.pct >= (minPct || 5))
          .filter(b => signFilter === 'pos' ? b.impact > 0 : signFilter === 'neg' ? b.impact < 0 : true)
          .sort((a,b) => Math.abs(b.impact) - Math.abs(a.impact))
          .slice(0, topN || 3)
          .sort((a,b) => b.pct - a.pct);
      }

      /* 主計算：回傳整份月報資料 */
      function _mrCalc(targetYM) {
        const { ecrs, ecns } = _mrCollectUnique();
        const range = _mrMonthRange(targetYM), prevRange = _mrMonthRange(_mrPrevMonth(targetYM));

        // 快照：整體進行中/回報中 %
        const ecrTotal = ecrs.length;
        const ecrIP = ecrs.filter(r => r.ecrStatusText === '進行中').length;
        const ecnTotal = ecns.length;
        const ecnClosedTotal = ecns.filter(r => r.ecnStatusText === '同意結束' || r.ecnStatusText === '結案').length;
        const ecnRW = ecns.filter(r => ['駁回結束','表單撤回'].includes(r.ecnStatusText)).length;
        const ecnExec = Math.max(0, ecns.filter(r => r.ecnStep2Time).length - ecnClosedTotal);
        const ecnIP = Math.max(0, ecnTotal - ecnClosedTotal - ecnExec - ecnRW);

        const snapshot = {
          ecrIPPct: _mrPct(ecrIP, ecrTotal),
          ecnIPPct: _mrPct(ecnIP, ecnTotal),
          ecnExecPct: _mrPct(ecnExec, ecnTotal),
          ecrIP, ecrTotal, ecnIP, ecnExec, ecnTotal,
        };

        // 本月/上月結案
        const ecrThis = _mrFilterClosed(ecrs, 'ecrStep7Time', range);
        const ecrPrev = _mrFilterClosed(ecrs, 'ecrStep7Time', prevRange);
        const ecnThis = _mrFilterClosed(ecns, 'ecnStep2Time', range);
        const ecnPrev = _mrFilterClosed(ecns, 'ecnStep2Time', prevRange);

        const durs = (arr, f) => arr.map(r => parseFloat(r[f])).filter(n => !isNaN(n) && n > 0);
        const ecrThisAvg = _mrAvg(durs(ecrThis, 'ecrDuration'));
        const ecrPrevAvg = _mrAvg(durs(ecrPrev, 'ecrDuration'));
        const ecnThisAvg = _mrAvg(durs(ecnThis, 'ecnDuration'));
        const ecnPrevAvg = _mrAvg(durs(ecnPrev, 'ecnDuration'));

        const buildSection = (closed, applyField, durField, thisAvg, sectionYM) => {
          if (!closed.length) return null;
          const { yearBuckets, monthBuckets } = _mrBuildBuckets(closed, applyField, durField, sectionYM);
          const total = closed.length;
          const withPct = b => ({ ...b, pct: total ? Math.round(b.count / total * 100) : 0 });
          const byYear = yearBuckets.map(withPct);
          const byMonth = monthBuckets.map(withPct);
          // candidates 排除自己整年，避免與月份重複
          const secY = _mrParseYM(sectionYM).y;
          const candidates = [...byYear.filter(b => b.key !== `y${secY}`), ...byMonth];
          return { count: total, avg: thisAvg, byYear, byMonth, candidates };
        };

        const prevYM = _mrPrevMonth(targetYM);
        return {
          targetYM, prevYM,
          snapshot,
          ecr: {
            thisCount: ecrThis.length, thisAvg: ecrThisAvg, prevAvg: ecrPrevAvg,
            section: buildSection(ecrThis, 'ecrApplyTime', 'ecrDuration', ecrThisAvg, targetYM),
            prevSection: buildSection(ecrPrev, 'ecrApplyTime', 'ecrDuration', ecrPrevAvg, prevYM),
          },
          ecn: {
            thisCount: ecnThis.length, thisAvg: ecnThisAvg, prevAvg: ecnPrevAvg,
            section: buildSection(ecnThis, 'ecnApplyTime', 'ecnDuration', ecnThisAvg, targetYM),
            prevSection: buildSection(ecnPrev, 'ecnApplyTime', 'ecnDuration', ecnPrevAvg, prevYM),
          },
        };
      }

      /* A 區摘要：{text, html} — text 供複製，html 將「本月因…」用 <mark> 強調 */
      function _mrBuildSummary(data) {
        const { y, m } = _mrParseYM(data.targetYM);
        const s = data.snapshot;
        const prevM = _mrParseYM(data.prevYM).m;
        const esc = Utils.escapeHtml;
        const fmtParts = arr => arr.map(b =>
          `${b.label.replace(/\s/g,'')}${b.count}筆(${b.pct}%)均${Math.round(b.avg)}天`).join('；');
        const MARK_OPEN = '<mark style="background:#fef08a;color:#78350f;padding:1px 4px;border-radius:2px;">';
        const MARK_CLOSE = '</mark>';

        // 本月上升→上月找拉低、本月找拉高；下降則相反；0 天差 skip
        const impactLine = (label, sec, prevSec, thisAvg, prevAvg) => {
          if (!sec || thisAvg === null) return null;
          if (prevAvg === null) {
            const head = `${label}本月均天${Math.round(thisAvg)}天（上月無結案可比較）`;
            const thisTop = _mrTopImpact(sec.candidates, thisAvg, sec.count, 3, 5);
            if (!thisTop.length) return { text: head, html: esc(head) };
            const cause = `本月因${fmtParts(thisTop)}`;
            return {
              text: `${head}，${cause}`,
              html: `${esc(head)}，${MARK_OPEN}${esc(cause)}${MARK_CLOSE}`,
            };
          }
          const diff = Math.round(thisAvg - prevAvg);
          if (diff === 0) return null;
          const up = diff > 0;
          const head = `${label}本月比上月${up?'上升':'下降'}${Math.abs(diff)}天`;
          const thisTop = _mrTopImpact(sec.candidates, thisAvg, sec.count, 3, 5, up?'pos':'neg');
          const prevTop = prevSec
            ? _mrTopImpact(prevSec.candidates, prevAvg, prevSec.count, 3, 5, up?'neg':'pos')
            : [];
          const segs = [], segsHtml = [];
          if (prevTop.length) {
            const seg = `${prevM}月因${fmtParts(prevTop)}拉${up?'低':'高'}`;
            segs.push(seg); segsHtml.push(esc(seg));
          }
          if (thisTop.length) {
            const seg = `本月因${fmtParts(thisTop)}故均天${up?'上升':'下降'}`;
            segs.push(seg);
            segsHtml.push(`${MARK_OPEN}${esc(seg)}${MARK_CLOSE}`);
          }
          if (!segs.length) return { text: head, html: esc(head) };
          return {
            text: `${head}。${segs.join('；')}`,
            html: `${esc(head)}。${segsHtml.join('；')}`,
          };
        };

        const lines = [];
        const push = (text, html) => lines.push({ text, html: html === undefined ? esc(text) : html });
        push(`【${y} 年 ${m} 月結算】`);
        push(`ECR 進行中 ${s.ecrIPPct}%，ECN 進行中 ${s.ecnIPPct}%，ECN 回報中 ${s.ecnExecPct}%`);
        const ecrImp = impactLine('ECR', data.ecr.section, data.ecr.prevSection, data.ecr.thisAvg, data.ecr.prevAvg);
        const ecnImp = impactLine('ECN', data.ecn.section, data.ecn.prevSection, data.ecn.thisAvg, data.ecn.prevAvg);
        if (ecrImp) lines.push(ecrImp);
        if (ecnImp) lines.push(ecnImp);
        return {
          text: lines.map(l => l.text).join('\n'),
          html: lines.map(l => l.html).join('\n'),
        };
      }

      /* B 區：詳細分析 HTML */
      function _mrBuildDetailHtml(data) {
        const { y, m } = _mrParseYM(data.targetYM);
        const renderGroups = (groups, overallAvg, totalCount, monthDiff) => {
          if (!groups.length) return '<div style="color:#94a3b8;padding-left:12px;">（無資料）</div>';
          const rows = groups.map(b => {
            const impact = totalCount ? b.count * (b.avg - overallAvg) / totalCount : 0;
            // 只標與本月方向同向的分組（差距≥1天）
            let icon = '';
            if (monthDiff !== null && Math.abs(impact) >= 1) {
              if (monthDiff > 0 && impact > 0) {
                icon = ' <i class="fa-solid fa-arrow-up" style="color:rgb(220 38 38);"></i>';
              } else if (monthDiff < 0 && impact < 0) {
                icon = ' <i class="fa-solid fa-arrow-down" style="color:rgb(4 120 87);"></i>';
              }
            }
            return `<tr>
              <td style="padding:3px 8px;border-bottom:1px solid #f1f5f9;">${Utils.escapeHtml(b.label)}</td>
              <td style="padding:3px 8px;border-bottom:1px solid #f1f5f9;text-align:right;">${b.count} 筆</td>
              <td style="padding:3px 8px;border-bottom:1px solid #f1f5f9;text-align:right;">${b.pct}%</td>
              <td style="padding:3px 8px;border-bottom:1px solid #f1f5f9;text-align:right;">${Math.round(b.avg)} 天${icon}</td>
            </tr>`;
          }).join('');
          return `<table style="width:100%;font-size:12px;margin-top:4px;">
            <thead><tr style="background:#f8fafc;color:#64748b;">
              <th style="padding:4px 8px;text-align:left;">分組</th>
              <th style="padding:4px 8px;text-align:right;">筆數</th>
              <th style="padding:4px 8px;text-align:right;">占比</th>
              <th style="padding:4px 8px;text-align:right;">均天</th>
            </tr></thead><tbody>${rows}</tbody></table>`;
        };
        const renderSection = (title, headerClass, sec, thisAvg, prevAvg) => {
          if (!sec) return `<div style="margin-bottom:16px;">
            <div class="${headerClass}" style="padding:6px 10px;border-radius:4px;font-weight:bold;">═ ${title} ${y}-${String(m).padStart(2,'0')} 本月無結案 ═</div>
          </div>`;
          // 差距四捨五入 = 0 視同無方向
          const rawDiff = (thisAvg !== null && prevAvg !== null) ? (thisAvg - prevAvg) : null;
          const monthDiff = (rawDiff !== null && Math.round(rawDiff) !== 0) ? rawDiff : null;
          let legend = '';
          if (monthDiff !== null) {
            legend = monthDiff > 0
              ? '<i class="fa-solid fa-arrow-up" style="color:rgb(220 38 38);"></i> = 本月上升的主要來源'
              : '<i class="fa-solid fa-arrow-down" style="color:rgb(4 120 87);"></i> = 本月下降的主要來源';
          }
          const legendHtml = legend ? `<div style="margin-top:6px;color:#64748b;font-size:11px;">${legend}</div>` : '';
          return `<div style="margin-bottom:20px;">
            <div class="${headerClass}" style="padding:6px 10px;border-radius:4px;font-weight:bold;">═ ${title} ${y}-${String(m).padStart(2,'0')} 結案 ${sec.count} 筆，整體均天 ${Math.round(sec.avg)} 天 ═</div>
            <div style="padding:6px 4px;">
              <div style="margin-top:8px;"><b style="color:#475569;"><i class="fa-solid fa-caret-right text-slate-400"></i> 依申請年份</b>${renderGroups(sec.byYear, sec.avg, sec.count, monthDiff)}</div>
              <div style="margin-top:8px;"><b style="color:#475569;"><i class="fa-solid fa-caret-right text-slate-400"></i> 依 ${y} 年申請月份</b>${renderGroups(sec.byMonth, sec.avg, sec.count, monthDiff)}</div>
              ${legendHtml}
            </div>
          </div>`;
        };
        return renderSection('ECR', 'bg-orange-50 text-orange-600', data.ecr.section, data.ecr.thisAvg, data.ecr.prevAvg)
          + renderSection('ECN', 'bg-blue-50 text-blue-600', data.ecn.section, data.ecn.thisAvg, data.ecn.prevAvg);
      }

      /* 詳細分析：純文字版（用於複製） */
      function _mrBuildDetailText(data) {
        const { y, m } = _mrParseYM(data.targetYM);
        const groupLines = (groups, overallAvg, totalCount, monthDiff) => {
          if (!groups.length) return '  （無資料）';
          return groups.map(b => {
            const impact = totalCount ? b.count * (b.avg - overallAvg) / totalCount : 0;
            let arrow = '';
            if (monthDiff !== null && Math.abs(impact) >= 1) {
              if (monthDiff > 0 && impact > 0) arrow = ' ↑';
              else if (monthDiff < 0 && impact < 0) arrow = ' ↓';
            }
            return `  ${b.label}：${b.count} 筆（${b.pct}%）均 ${Math.round(b.avg)} 天${arrow}`;
          }).join('\n');
        };
        const sectionText = (title, sec, thisAvg, prevAvg) => {
          if (!sec) return `═ ${title} ${y}-${String(m).padStart(2,'0')} 本月無結案 ═`;
          const rawDiff = (thisAvg !== null && prevAvg !== null) ? (thisAvg - prevAvg) : null;
          const monthDiff = (rawDiff !== null && Math.round(rawDiff) !== 0) ? rawDiff : null;
          const lines = [
            `═ ${title} ${y}-${String(m).padStart(2,'0')} 結案 ${sec.count} 筆，整體均天 ${Math.round(sec.avg)} 天 ═`,
            `依申請年份：`,
            groupLines(sec.byYear, sec.avg, sec.count, monthDiff),
            `依 ${y} 年申請月份：`,
            groupLines(sec.byMonth, sec.avg, sec.count, monthDiff),
          ];
          if (monthDiff !== null) {
            lines.push(monthDiff > 0 ? '（↑ = 本月上升的主要來源）' : '（↓ = 本月下降的主要來源）');
          }
          return lines.join('\n');
        };
        return sectionText('ECR', data.ecr.section, data.ecr.thisAvg, data.ecr.prevAvg)
          + '\n\n' + sectionText('ECN', data.ecn.section, data.ecn.thisAvg, data.ecn.prevAvg);
      }

      /* 入口：開啟 modal */
      function showMonthlyReportModal() {
        if (!ecrEcnData.length) return ToastModule.show('尚無資料，請先同步 BPM API', 'warning');
        const sel = document.getElementById('monthlyReportMonthSelect');
        const opts = _mrBuildOptions();
        sel.innerHTML = opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
        const def = _mrDefaultMonth();
        if (opts.some(o => o.value === def)) sel.value = def;
        renderMonthlyReport();
        document.getElementById('monthlyReportModal').classList.add('show');
      }

      /* 重新渲染（月份切換時） */
      function renderMonthlyReport() {
        const ym = document.getElementById('monthlyReportMonthSelect').value;
        if (!ym) return;
        const warn = document.getElementById('monthlyReportWarning');
        if (ym === _mrNow()) warn.style.display = ''; else warn.style.display = 'none';
        const data = _mrCalc(ym);
        window._monthlyReportCache = data;
        const summary = _mrBuildSummary(data);
        window._monthlyReportSummaryText = summary.text;
        document.getElementById('monthlyReportSummary').innerHTML = summary.html;
        document.getElementById('monthlyReportDetail').innerHTML = _mrBuildDetailHtml(data);
      }

      /* 複製摘要（純文字，不含 mark） */
      function copyMonthlyReportSummary() {
        const t = window._monthlyReportSummaryText || '';
        navigator.clipboard.writeText(t).then(
          () => ToastModule.show('已複製精簡摘要', 'success'),
          () => ToastModule.show('複製失敗', 'error'));
      }
      /* 複製詳細分析 */
      function copyMonthlyReportDetail() {
        if (!window._monthlyReportCache) return;
        const t = _mrBuildDetailText(window._monthlyReportCache);
        navigator.clipboard.writeText(t).then(
          () => ToastModule.show('已複製詳細分析', 'success'),
          () => ToastModule.show('複製失敗', 'error'));
      }

      function showEcrEcnStepModal(type){
        if(!ecrEcnData.length)return ToastModule.show('請先匯入資料','warning');
        document.getElementById('ecrEcnStepModalTitle').textContent=`${type} 各關卡簽核中統計`;
        const fSt=type==='ECR'?'ecrStatusText':'ecnStatusText',fSi=type==='ECR'?'ecrSignInfo':'ecnSignInfo',fSe=type==='ECR'?'ecrSerial':'ecnSerial';
        const order=type==='ECR'?StepNameModule.ECR_ORDER:StepNameModule.ECN_ORDER;
        const selY=getSelectedYear('ecrEcnYearSelect');
        const fDate=type==='ECR'?'ecrApplyTime':'ecnApplyTime';
        const rows=getEcrEcnFilteredByYear(),sc={},seen=new Set();
        for(const r of rows){const s=r[fSe];if(!s||ApiAdapter.ECN_PLACEHOLDERS.has(s)||seen.has(s)||r[fSt]!=='進行中')continue;if(selY&&DateUtils.normalizeYear(r[fDate])!==selY)continue;seen.add(s);
          // 同關卡多名簽核人(代理人機制)算 1 次：每張單依關卡名稱去重
          const stepSet=new Set();
          (r[fSi]||'').split('\n').filter(Boolean).forEach(l=>{const sh=extractStepShort(l);if(sh&&!stepSet.has(sh)){stepSet.add(sh);sc[sh]=(sc[sh]||0)+1;}});}
        const total=Object.values(sc).reduce((s,c)=>s+c,0);
        const barC=type==='ECR'?'bg-orange-400':'bg-blue-400';
        const fl=order;
        const body=document.getElementById('ecrEcnStepModalBody');
        if(!fl.length){body.innerHTML='<div class="text-center text-gray-400 py-6">目前沒有進行中的簽核</div>';}
        else{body.innerHTML=`<div class="mb-3 text-xs text-gray-500">共 <b class="text-gray-700">${seen.size}</b> 張${type}進行中</div>
          <table class="search-help-table"><tr><td style="font-weight:600;color:#6b7280;">關卡</td><td style="text-align:center;font-weight:600;color:#6b7280;width:50px;">數量</td><td style="font-weight:600;color:#6b7280;width:140px;">佔比</td></tr>
          ${fl.map(step=>{const c=sc[step]||0,p=total?(c/total*100).toFixed(1):'0';
            const dim=c===0?'opacity-40':'';
            return`<tr class="${dim}"><td>${Utils.escapeHtml(step)}</td><td style="text-align:center;font-weight:bold;${c?'color:#0078d4;':'color:#d1d5db;'}">${c}</td><td><div style="display:flex;align-items:center;gap:6px;"><div style="flex:1;height:6px;background:#f3f4f6;border-radius:99px;overflow:hidden;"><div style="height:100%;border-radius:99px;width:${p}%;" class="${barC}"></div></div>${c?`<span style="font-size:10px;color:#9ca3af;width:36px;text-align:right;">${p}%</span>`:''}</div></td></tr>`;}).join('')}</table>`;}
        const m=document.getElementById('ecrEcnStepModal');m.classList.remove('hidden');m.classList.add('flex');
      }
 
      function getStepStatsData(type){
        const fSt=type==='ECR'?'ecrStatusText':'ecnStatusText',fSi=type==='ECR'?'ecrSignInfo':'ecnSignInfo',fSe=type==='ECR'?'ecrSerial':'ecnSerial';
        const order=type==='ECR'?StepNameModule.ECR_ORDER:StepNameModule.ECN_ORDER,selY=getSelectedYear('ecrEcnYearSelect'),fDate=type==='ECR'?'ecrApplyTime':'ecnApplyTime',rows=getEcrEcnFilteredByYear(),sc={},seen=new Set();
        for(const r of rows){const s=r[fSe];if(!s||ApiAdapter.ECN_PLACEHOLDERS.has(s)||seen.has(s)||r[fSt]!=='進行中')continue;if(selY&&DateUtils.normalizeYear(r[fDate])!==selY)continue;seen.add(s);
          const stepSet=new Set();
          (r[fSi]||'').split('\n').filter(Boolean).forEach(l=>{const sh=extractStepShort(l);if(sh&&!stepSet.has(sh)){stepSet.add(sh);sc[sh]=(sc[sh]||0)+1;}});}
        return order.map(s=>({關卡:s,數量:sc[s]||0}));
      }

      function copyStepStats() {
        const title = document.getElementById('ecrEcnStepModalTitle').textContent || '';
        const type = title.includes('ECR') ? 'ECR' : 'ECN';
        const stats = getStepStatsData(type);
        const lines = ['關卡\t數量'];
        for (const s of stats) lines.push(`${s.關卡}\t${s.數量}`);
        navigator.clipboard.writeText(lines.join('\n')).then(() => {
          const btn = document.getElementById('copyStepStatsBtn');
          btn.innerHTML = '<i class="fa-solid fa-check mr-1"></i>已複製';
          setTimeout(() => { btn.innerHTML = '<i class="fa-solid fa-copy mr-1"></i>複製'; }, 2000);
          ToastModule.show('已複製到剪貼簿，可直接貼到 Excel', 'success');
        }).catch(() => ToastModule.show('複製失敗', 'error'));
      }

      // ==========================================
      // 13. 設定模組 (Page 15, 16)
      // ==========================================

      /* 人員設定 */
      function renderSettingsPage() {
        let e = document.getElementById("settingsContainer");
        if (!e) return;
        let t = settingsData.maintainers.filter((e) => e.active),
          i = settingsData.maintainers.filter((e) => !e.active);
        e.innerHTML = `
              <!-- 新增人員區塊 -->
              <div class="mb-6 p-6 bg-white border border-gray-200 rounded-xl shadow-sm">
              <h4 class="flex items-center gap-2 mb-4 font-bold text-lg text-gray-700"><i class="fa-solid fa-user-plus text-ms-blue"></i> 新增人員</h4>
              <div class="flex flex-col gap-3 md:flex-row">
              <input type="text" id="newMaintainerId" class="px-4 py-2 border border-gray-300 rounded-lg outline-none md:w-1/3 focus:border-ms-blue focus:ring-2 focus:ring-ms-blue" placeholder="輸入工號 (即登入帳號)">
              <input type="text" id="newMaintainerName" class="flex-1 px-4 py-2 border border-gray-300 rounded-lg outline-none focus:border-ms-blue focus:ring-2 focus:ring-ms-blue" placeholder="輸入人員姓名">
              <button onclick="addMaintainer()" class="px-6 py-2 whitespace-nowrap btn-primary"><i class="fa-solid fa-plus mr-2"></i>新增</button></div></div>

              <!-- 人員列表區塊 -->
              <div class="grid gap-6 grid-cols-1 mb-6 lg:grid-cols-2">

              <!-- 啟用中人員 -->
              <div class="flex flex-col h-full bg-white border border-gray-200 rounded-xl shadow-sm">
              <div class="p-4 bg-green-50/50 border-b border-gray-100 rounded-t-xl">
              <h4 class="flex items-center gap-2 font-bold text-lg text-gray-700"><i class="fa-solid fa-user-check text-green-600"></i> 啟用中 (${t.length})</h4></div>
              <div class="p-4 space-y-3">
                  ${
                    t.length
                      ? t
                          .map(
                            (e) => `
                  <div class="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg transition-shadow group hover:shadow-sm"><div>
                  <div class="font-bold text-sm text-gray-800">${e.name}</div>
                  <div class="mt-0.5 text-xs text-gray-500"><i class="fa-solid fa-id-badge mr-1"></i>${e.id || '<span class="text-amber-600">未設定</span>'}</div></div>
                  <div class="flex gap-2 opacity-100 transition-opacity lg:group-hover:opacity-100 lg:opacity-0">
                  <button onclick="openEditMaintainer('${e.name}')" class="p-1.5 text-blue-600 rounded-md transition-colors hover:bg-blue-50" title="修改資料"><i class="fa-solid fa-pen-to-square"></i></button>
                  <button onclick="toggleMaintainer('${e.name}')" class="p-1.5 text-amber-600 rounded-md transition-colors hover:bg-amber-50" title="停用"><i class="fa-solid fa-pause"></i></button>
                  <button onclick="removeMaintainer('${e.name}')" class="p-1.5 text-red-600 rounded-md transition-colors hover:bg-red-50" title="刪除"><i class="fa-solid fa-trash-can"></i></button></div></div>`,
                          )
                          .join("")
                      : '<div class="py-4 text-sm text-center text-gray-400">尚無啟用中的人員</div>'
                  }</div></div>

            <!-- 已停用人員 -->
            <div class="flex flex-col h-full bg-white border border-gray-200 rounded-xl shadow-sm">
            <div class="p-4 bg-gray-50 border-b border-gray-100 rounded-t-xl">
            <h4 class="flex items-center gap-2 font-bold text-lg text-gray-500"><i class="fa-solid fa-user-xmark"></i> 已停用 (${i.length})</h4></div>
            <div class="p-4 space-y-3">
               ${
                 i.length
                   ? i
                       .map(
                         (e) => `
               <div class="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg opacity-75 transition-all group hover:opacity-100"><div>
               <div class="font-medium text-sm text-gray-500">${e.name}</div>
               <div class="mt-0.5 text-xs text-gray-400">${e.id || "無工號"}</div></div>
               <div class="flex gap-2">
               <button onclick="openEditMaintainer('${e.name}')" class="p-1.5 text-blue-600 rounded-md transition-colors hover:bg-blue-50" title="修改資料"><i class="fa-solid fa-pen-to-square"></i></button>
               <button onclick="toggleMaintainer('${e.name}')" class="p-1.5 text-green-600 rounded-md transition-colors hover:bg-green-50" title="啟用"><i class="fa-solid fa-play"></i></button>
               <button onclick="removeMaintainer('${e.name}')" class="p-1.5 text-red-600 rounded-md transition-colors hover:bg-red-50" title="刪除"><i class="fa-solid fa-trash-can"></i></button></div></div>
               `,
                       )
                       .join("")
                   : '<div class="py-4 text-sm text-center text-gray-400">尚無已停用的人員</div>'
               }</div></div></div>

               <div class="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
               <div class="flex items-start gap-3"><i class="fa-solid fa-circle-info text-blue-500 mt-0.5"></i>
               <div class="text-sm text-blue-700"><p class="font-bold mb-1">使用說明</p>
               <ul class="space-y-1 text-blue-600 list-disc list-inside">
               <li>啟用中的人員會出現在下拉選單中。</li>
               <li>停用人員後，已有的資料會保留顯示。</li>
               <li>統計報告會自動依據啟用人員生成卡片。</li>
               <li>工號即為登入帳號與密碼。</li></ul></div></div></div>`;
      }
      async function saveSettings(toastMsg) {
        const { ID, FILES } = GIST_CONFIG.ECN;
        try {
          const res = await fetch(`${GITHUB_API_BASE}/gists/${ID}`, {
            method: "PATCH",
            headers: {
              Authorization: `token ${GITHUB_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              files: {
                [FILES.SETTINGS]: { content: JSON.stringify(settingsData) },
              },
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          localStorage.setItem("ec_settings", JSON.stringify(settingsData));
          ToastModule.show(toastMsg || "設定已儲存", "success");
          const activePage = document.querySelector(".page.active");
          if (activePage && activePage.id === "page16") {
            renderOptionSettingsPage();
          } else {
            renderSettingsPage();
          }
        } catch (e) {
          console.error("儲存設定失敗:", e);
          ToastModule.show("儲存設定失敗", "error");
        }
      }
      async function addMaintainer() {
        const id = document.getElementById("newMaintainerId")?.value?.trim();
        const name = document.getElementById("newMaintainerName")?.value?.trim();
        if (!name || !id) return ToastModule.show("請輸入工號與姓名", "warning");
        if (settingsData.maintainers.some((m) => m.name === name)) return ToastModule.show("人員姓名已存在", "warning");
        if (settingsData.maintainers.some((m) => m.id === id)) return ToastModule.show("工號已存在", "warning");
        settingsData.maintainers.push({ name, id, active: true });
        document.getElementById("newMaintainerName").value = "";
        document.getElementById("newMaintainerId").value = "";
        await saveSettings("人員設定已儲存");
      }
      function openEditMaintainer(name) {
        const person = settingsData.maintainers.find((m) => m.name === name);
        if (!person) return;
        document.getElementById("editOriginalName").value = person.name;
        document.getElementById("editNameInput").value = person.name;
        document.getElementById("editIdInput").value = person.id || "";
        document.getElementById("editMaintainerModal").classList.remove("hidden");
      }
      async function saveMaintainerEdit() {
        const targetName = document.getElementById("editOriginalName").value;
        const newId = document.getElementById("editIdInput").value?.trim();
        if (!targetName) return;
        if (newId && settingsData.maintainers.some((m) => m.id === newId && m.name !== targetName)) {
          return ToastModule.show("此工號已被其他人員使用", "warning");
        }
        const personIndex = settingsData.maintainers.findIndex((m) => m.name === targetName);
        if (personIndex !== -1) {
          settingsData.maintainers[personIndex].id = newId;
          document.getElementById("editMaintainerModal").classList.add("hidden");
          await saveSettings(`已更新 ${targetName} 的資料`);
        }
      }
      async function toggleMaintainer(i) {
        let n = settingsData.maintainers.find((n) => n.name === i);
        if (n) { n.active = !n.active; await saveSettings("人員設定已儲存"); }
      }
      async function removeMaintainer(n) {
        if (confirm(`確定要刪除「${n}」？`)) {
          settingsData.maintainers = settingsData.maintainers.filter((i) => i.name !== n);
          await saveSettings("人員設定已儲存");
        }
      }

      /* 選項設定 */
      function renderOptionSettingsPage() {
        let e = document.getElementById("optionSettingsContainer");
        if (!e) return;
        let t = '<div class="grid gap-6 grid-cols-1 pb-24 md:grid-cols-2">';
        ((t += [
          { title: "新建板階/BOM - 申請人", key: "board_applicant" },
          { title: "PCB 維護 - 類別", key: "pcb_category" },
          { title: "協助項目 - 類別", key: "assist_category" },
          { title: "資料匯出 - 明細分類", key: "plm_category" },
        ]
          .map((e) => {
            let t = (settingsData.dropdowns && settingsData.dropdowns[e.key]) || [],
              r = t.filter((e) => e.active),
              o = t.filter((e) => !e.active),
              i = (t, r, o) =>
                `<div class="flex items-center justify-between px-2 py-2 text-xs border-b border-gray-100 transition-colors group hover:bg-gray-50 last:border-0">
                  <div class="flex items-center gap-2 overflow-hidden">
                  <span class="${o ? "text-gray-700 font-medium" : "text-gray-400 line-through"} truncate" title="${t.text}">${t.text}</span>
                    ${o ? "" : '<span class="px-1.5 text-[10px] text-gray-400 bg-gray-100 rounded">停用</span>'}</div>
                  <div class="flex items-center gap-2 shrink-0 opacity-100 transition-opacity lg:group-hover:opacity-100 lg:opacity-0">
                  <button onclick="toggleDropdownOption('${e.key}', ${r})" class="${o ? "text-amber-600 hover:bg-amber-50" : "text-green-600 hover:bg-green-50"} p-1.5 rounded-md transition-colors" title="${o ? "停用" : "啟用"}"><i class="fa-solid ${o ? "fa-pause" : "fa-play"}"></i></button>
                  <button onclick="deleteDropdownOption('${e.key}', ${r})" class="p-1.5 text-red-600 rounded-md transition-colors hover:bg-red-50" title="刪除"><i class="fa-solid fa-trash-can"></i></button></div></div>`;
            return `
                  <div class="flex flex-col h-[300px] bg-white border border-gray-200 rounded-lg shadow-sm">
                  <!-- 卡片標題 -->
                  <div class="flex items-center justify-between shrink-0 px-4 py-3 bg-gray-50 border-b border-gray-200 rounded-t-lg">
                  <h4 class="flex items-center gap-2 font-bold text-sm text-gray-700"><i class="fa-solid fa-square-caret-down text-ms-blue"></i> ${e.title}</h4>
                  <span class="px-2 py-0.5 font-medium text-xs text-gray-500 bg-white border border-gray-200 rounded">${t.length}</span></div>
                  <!-- 新增輸入框 (固定在上方) -->
                  <div class="shrink-0 p-3 bg-white border-b border-gray-100">
                  <div class="flex relative"><input type="text" id="newOptText_${e.key}" class="w-full py-1.5 pr-10 pl-3 text-sm border border-gray-300 rounded-md outline-none transition-all placeholder-gray-400 focus:border-ms-blue focus:ring-2 focus:ring-ms-blue" placeholder="輸入選項名稱" onkeyup="if(event.key==='Enter') addDropdownOption('${e.key}')">
                  <button onclick="addDropdownOption('${e.key}')" class="absolute bottom-1 right-1 top-1 px-2.5 font-bold text-xs text-gray-500 bg-gray-100 rounded transition-colors hover:text-white hover:bg-ms-blue">新增</button></div></div>
                  <!-- 捲動清單區域 -->
                  <div class="flex-1 overflow-y-auto p-1">${r.length > 0 ? r.map((e) => i(e, t.indexOf(e), !0)).join("") : '<div class="py-8 text-xs text-center text-gray-300 italic">無啟用項目</div>'}
                      ${o.length > 0 ? `<div class="mt-2 px-3 py-2 font-bold text-[10px] text-gray-400 tracking-wider uppercase bg-gray-50 border-y border-gray-100">已停用項目 (${o.length})</div> ${o.map((e) => i(e, t.indexOf(e), !1)).join("")}` : ""}</div></div>`;
          })
          .join("")),
          (t += "</div>"),
          (e.innerHTML = t));
      }
      async function addDropdownOption(n) {
        let d = document.getElementById(`newOptText_${n}`);
        if (!d) return;
        let o = d.value.trim();
        if (!o) return ToastModule.show("請輸入選項文字", "warning");
        let t = o;
        settingsData.dropdowns || (settingsData.dropdowns = {});
        settingsData.dropdowns[n] || (settingsData.dropdowns[n] = []);
        if (settingsData.dropdowns[n].some((item) => item.value === t))
          return ToastModule.show("選項值已存在", "warning");
        settingsData.dropdowns[n].push({ text: o, value: t, active: !0 });
        d.value = "";
        await saveSettings("選項設定已儲存");
        renderOptionSettingsPage();
      }
      async function toggleDropdownOption(o, d) {
        if (settingsData.dropdowns && settingsData.dropdowns[o] && settingsData.dropdowns[o][d]) {
          settingsData.dropdowns[o][d].active = !settingsData.dropdowns[o][d].active;
          await saveSettings("選項設定已儲存");
          renderOptionSettingsPage();
        }
      }
      async function deleteDropdownOption(o, d) {
        if (confirm("確定要刪除此選項嗎？") && settingsData.dropdowns && settingsData.dropdowns[o]) {
          settingsData.dropdowns[o].splice(d, 1);
          await saveSettings("選項設定已儲存");
          renderOptionSettingsPage();
        }
      }

      // ==========================================
      // 14. 匯出功能 (Excel Export)
      // ==========================================

      function exportDetailList() {
        let e = getSelectedYear("ecnYearSelect"),
          base = _filteredExportData || ecnData,
          p = base;
        (e && (p = base.filter((p) => !p.month || p.month.startsWith(e))),
          exportGenericExcel({
            data: p,
            columnMapping: {
              id: "ECN 單號",
              ecrId: "ECR 單號",
              status: "表單狀態",
              applicant: "申請人",
              partNo: "變更品號",
              approver: "協辦人",
              priority: "需求等級",
              changeReason: "變更原因分類",
              scope: "變更範圍",
              applyTime: "申請日",
              approveTime1: "【一】簽核日",
              approveTime: "【二】簽核日",
              _totalDays: "全流程",
              _transferDate: "【二】收件日",
              plmStart: "PLM 啟動",
              plmRelease: "PLM 發佈",
              _plmWork: "PLM 作業",
              _plmSign: "PLM 簽核",
              _erpConfirm: "ERP 確認",
              _ecWorkDays: "EC內部天數",
              _complexity: "複雜度",
              _overdue: "逾期",
              overdueNote: "逾期說明",
            },
            fileName: `ECN_List_${DateUtils.today()}.xlsx`,
            sheetName: "ECN_List",
            transform(e) {
              let p = isKPITarget(e.approver),
                t = e.isRejected || e.isRejected1,
                isVoid = StatusModule.isVoid(e.status),
                skip = t || isVoid,
                r = skip ? "-" : DateUtils.calcWorkDays(e.applyTime, e.approveTime),
                transferDt = skip ? "" : (e.arriveDate || ""),
                od = p && !skip && transferDt ? DateUtils.calcWorkDays(transferDt, e.approveTime) : null,
                a = OverdueModule.getThresholdPage1(e.priority, e.complexity);
              return {
                ...e,
                applyTime: DateUtils.parse(e.applyTime) || "",
                approveTime1: DateUtils.parse(e.approveTime1) || "",
                approveTime: DateUtils.parse(e.approveTime) || "",
                _transferDate: skip ? "" : DateUtils.parse((e.arriveDate || "")) || "",
                plmStart: DateUtils.parse(e.plmStart) || "",
                plmRelease: DateUtils.parse(e.plmRelease) || "",
                _totalDays: r,
                _plmWork: p && !skip ? DateUtils.calcWorkDays((e.arriveDate || ""), e.plmStart) : "",
                _plmSign: p && !skip ? DateUtils.calcWorkDays(e.plmStart, e.plmRelease) : "",
                _erpConfirm: p && !skip ? DateUtils.calcWorkDays(e.plmRelease, e.approveTime) : "",
                _ecWorkDays: p && !skip ? DateUtils.calcWorkDays((e.arriveDate || ""), e.approveTime) : "",
                _complexity: p ? (skip ? "" : e.complexity || "") : "",
                _overdue: p && !skip && e.complexity && typeof od === "number" && a ? (od > a ? od - a : "未逾期") : "",
                overdueNote: e.overdueNote || "",
              };
            },
          }));
      }
      function exportPCBExcel() {
        exportGenericExcel({
            data: _filteredExportData || pcbStore.list,
            yearSelectId: "pcbListYearSelect",
            dateField: getPCBRowYear,
            columnMapping: {
              id: "PCB 單號",
              partNo: "PCB 料號",
              status: "表單狀態",
              applicant: "申請人",
              priority: "需求等級",
              name2: "【二】部門主管",
              time2: "【二】簽核",
              name3: "【三】工程中心",
              time3: "【三】簽核",
              updateDate1: "更新日期(二三)",
              kpi1: "(二↔三)",
              _overdue1: "逾期(二三)",
              note1: "說明(二三)",
              name7: "【七】Layout",
              time7: "【七】簽核",
              name8: "【八】工程中心",
              time8: "【八】簽核",
              updateDate2: "更新日期(七八)",
              kpi2: "(七↔八)",
              _overdue2: "逾期(七八)",
              note2: "說明(七八)",
              needApprove: "承認PCB",
              name13: "【十五】工程中心",
              time13: "【十五】簽核",
              name15: "【十八】工程中心",
              time15: "【十八】簽核",
              kpi3: "(十五↔十八)",
            },
            fileName: `PCB_List_${DateUtils.today()}.xlsx`,
            sheetName: "PCB_List",
            transform(e) {
              return {
                ...e,
                time2: DateUtils.parse(e.time2) || "",
                time3: DateUtils.parse(e.time3) || "",
                updateDate1: DateUtils.parse(e.updateDate1) || "",
                _overdue1: OverdueModule.getOverdueDaysPage3(e.kpi1, e.isRejected3) ?? "",
                time7: DateUtils.parse(e.time7) || "",
                time8: DateUtils.parse(e.time8) || "",
                updateDate2: DateUtils.parse(e.updateDate2) || "",
                _overdue2: OverdueModule.getOverdueDaysPage3(e.kpi2, e.isRejected8) ?? "",
                time13: DateUtils.parse(e.time13) || "",
                time15: DateUtils.parse(e.time15) || "",
              };
            },
          });
      }
      function exportTransferExcel() {
        let a = (_filteredExportData || transferData || []).filter((e) => (e.type || "ECN") === currentTransferType),
          r = "ECR" === currentTransferType ? "ECR轉單" : "ECN轉單";
        exportGenericExcel({
            data: a,
            yearSelectId: "transferYearSelect",
            dateField: "approveDate",
            columnMapping: {
              formId: "表單編號",
              dept: "申請部門",
              applicant: "申請人",
              step: "簽核步驟",
              arriveDate: "送達日期",
              result: "簽核結果",
              approveDate: "簽核日期",
              _workDays: "工作日",
              executor: "執行人",
              comment: "簽核意見",
            },
            fileName: `${r}清單_${DateUtils.today()}.xlsx`,
            sheetName: r,
            transform: (e) => ({
              ...e,
              arriveDate: DateUtils.parse(e.arriveDate) || "",
              approveDate: DateUtils.parse(e.approveDate) || "",
              _workDays: DateUtils.calcWorkDays(e.arriveDate, e.approveDate),
            }),
          });
      }
      function exportNewBoardExcel() {
        exportGenericExcel({
          data: _filteredExportData || boardData.newBoard,
          yearSelectId: "yearSelect_p5",
          dateField: getNewBoardSortDate,
          columnMapping: {
            applyDate: "申請日期",
            updateDate: "更新日期",
            createDate: "建立日期",
            partNo: "板階料號",
            _stage: "階段",
            projectCode: "專案代碼",
            applicant: "申請人",
            hasBOM: "是否有BOM",
            bomDate: "BOM發佈日",
            creator: "建立人",
            priority: "需求等級",
            _workDays: "作業天數",
            _overdue: "逾期",
            overdueNote: "說明",
          },
          fileName: `新建板階清單_${DateUtils.today()}.xlsx`,
          sheetName: "新建板階",
          transform: (e) => {
            const isCancelled = e.createDate === "取消";
            let t = isCancelled ? "" : DateUtils.calcWorkDays(e.updateDate || e.applyDate, e.createDate);
            const limit = OverdueModule.getThresholdPage5(e.priority);
            return {
              ...e,
              applyDate: DateUtils.parse(e.applyDate) || "",
              updateDate: DateUtils.parse(e.updateDate) || "",
              createDate: isCancelled ? "取消" : (DateUtils.parse(e.createDate) || ""),
              bomDate: DateUtils.parse(e.bomDate) || "",
              _stage: getStageFromPartNo(e.partNo),
              _workDays: isCancelled ? "-" : t,
              _overdue: !isCancelled && typeof t === "number" && limit ? (t > limit ? t - limit : "未逾期") : "",
              overdueNote: e.overdueNote || "",
            };
          },
        });
      }
      function exportMaintainExcel() {
        exportGenericExcel({
          data: boardData.maintain,
          columnMapping: {
            date: "維護日期",
            maintainer: "維護人",
            partNo: "板階料號",
            note: "備註",
          },
          fileName: `板階維護清單_${DateUtils.today()}.xlsx`,
          sheetName: "板階維護",
          yearSelectId: "yearSelect_p6",
          dateField: "date",
          transform: (e) => ({ ...e, date: DateUtils.parse(e.date) || "" }),
        });
      }
      function exportGPMSExcel() {
        exportGenericExcel({
          data: _filteredExportData || pcbStore.gpms,
          columnMapping: {
            date: "日期",
            pcbNo: "PCB單號",
            partNo: "料號",
            maintainer: "執行人",
            note: "備註",
          },
          fileName: `GPMS啟動清單_${DateUtils.today()}.xlsx`,
          sheetName: "GPMS啟動",
          yearSelectId: "yearSelect_p8",
          dateField: "date",
          transform: (e) => ({ ...e, date: DateUtils.parse(e.date) || "" }),
        });
      }
      function exportPCBMaintainExcel() {
        exportGenericExcel({
          data: _filteredExportData || pcbStore.maintain,
          columnMapping: {
            date: "日期",
            partNo: "料號",
            maintainer: "執行人",
            type: "類別",
            category: "備註",
          },
          fileName: `PCB維護清單_${DateUtils.today()}.xlsx`,
          sheetName: "PCB維護",
          yearSelectId: "yearSelect_p9",
          dateField: "date",
          transform: (e) => ({ ...e, date: DateUtils.parse(e.date) || "" }),
        });
      }
      function exportDisableExcel() {
        exportGenericExcel({
          data: _filteredExportData || disableSubData,
          columnMapping: {
            date: "日期",
            ecnNo: "ECN 單號",
            tier: "階層",
            partNo: "料號",
            executor: "執行人",
            note: "備註",
          },
          fileName: `停用取替代清單_${DateUtils.today()}.xlsx`,
          sheetName: "停用取替代",
          yearSelectId: "disableYearSelect",
          dateField: "date",
          transform: (e) => ({ ...e, date: DateUtils.parse(e.date) || "" }),
        });
      }
      function exportAssistExcel() {
        exportGenericExcel({
          data: _filteredExportData || assistData,
          columnMapping: {
            date: "日期",
            category: "類別",
            content: "內容",
            person: "執行人",
            note: "備註",
          },
          fileName: `協助項目統計_${DateUtils.today()}.xlsx`,
          sheetName: "協助項目",
          yearSelectId: "assistYearSelect",
          dateField: "date",
          transform: (e) => ({ ...e, date: DateUtils.parse(e.date) || "" }),
        });
      }
      function exportDccExcel() {
        exportGenericExcel({
          data: _filteredExportData || dccData,
          columnMapping: {
            date: "日期",
            applicant: "申請人",
            unit: "申請單位",
            content: "內容",
            executor: "執行人",
            note: "備註",
          },
          fileName: `管制文件申請統計_${DateUtils.today()}.xlsx`,
          sheetName: "管制文件申請",
          yearSelectId: "dccYearSelect",
          dateField: "date",
          transform: (e) => ({ ...e, date: DateUtils.parse(e.date) || "" }),
        });
      }
      function exportBOMExcel() {
        exportGenericExcel({
          data: _filteredExportData || bomData,
          yearSelectId: "bomYearSelect",
          dateField: getBOMSortDate,
          columnMapping: {
            receiveDate: "收件日期",
            updateDate: "更新日期",
            applicant: "申請人",
            unit: "單位",
            partNo: "料號",
            _stage: "階段",
            priority: "需求等級",
            completeDate: "完成日期",
            executor: "執行人",
            _workDays: "作業天數",
            _overdue: "逾期",
            overdueNote: "說明",
          },
          fileName: `BOM建立清單_${DateUtils.today()}.xlsx`,
          sheetName: "BOM建立",
          transform(e) {
            const isCancelled = e.completeDate === "取消";
            let t = isCancelled ? "" : DateUtils.calcWorkDays(e.updateDate || e.receiveDate, e.completeDate);
            let o = OverdueModule.getThresholdPage17(e.priority);
            return {
              ...e,
              receiveDate: DateUtils.parse(e.receiveDate) || "",
              updateDate: DateUtils.parse(e.updateDate) || "",
              _stage: getStageFromPartNo(e.partNo),
              completeDate: isCancelled ? "取消" : (DateUtils.parse(e.completeDate) || ""),
              _workDays: isCancelled ? "-" : t,
              _overdue: !isCancelled && "number" == typeof t && o ? (t > o ? t - o : "未逾期") : "",
              overdueNote: e.overdueNote || "",
            };
          },
        });
      }

      function exportEcrEcnExcel() {
        exportGenericExcel({
          data: getEcrEcnFilteredByYear(_filteredExportData),
          columnMapping: {
            ecrSerial:'ECR單號', ecrStatusText:'ECR狀態', ecrApplyTime:'ECR申請日',
            ecrApplicantDept:'ECR申請部門', ecrApplicant:'ECR申請人', _ecrSign:'ECR簽核', ecrStep7Time:'ECR結案日', ecrDuration:'ECR天數',
            ecnSerial:'ECN單號', ecnStatusText:'ECN狀態', ecnApplyTime:'ECN申請日',
            ecnApplicantDept:'ECN申請部門', ecnApplicant:'ECN申請人', _ecnSign:'ECN簽核', ecnStep2Time:'ECN二關日', ecnDuration:'ECN天數'
          },
          fileName: `ECR_ECN追蹤_${DateUtils.today()}.xlsx`,
          sheetName: 'ECR_ECN追蹤',
          transform(e) {
            return {
              ...e,
              ecrApplyTime: DateUtils.parse(e.ecrApplyTime) || '',
              ecrStep7Time: DateUtils.parse(e.ecrStep7Time) || '',
              ecnApplyTime: DateUtils.parse(e.ecnApplyTime) || '',
              ecnStep2Time: DateUtils.parse(e.ecnStep2Time) || '',
              ecrDuration: e.ecrDuration !== '' ? parseFloat(e.ecrDuration) || '' : '',
              ecnDuration: e.ecnDuration !== '' ? parseFloat(e.ecnDuration) || '' : '',
              _ecrSign: (e.ecrSignInfo || '').replace(/\n+/g, '\n'),
              _ecnSign: (e.ecnSignInfo || '').replace(/\n+/g, '\n'),
            };
          },
        });
      }

      function exportPLMExcel() {
        if (!plmData || !plmData.length) return ToastModule.show('無資料', 'warning');
        exportGenericExcel({
          data: plmData,
          yearSelectId: "plmYearSelect",
          dateField: "date",
          columnMapping: { date:'日期', category:'明細分類', executor:'執行人' },
          fileName: `資料匯出統計_${DateUtils.today()}.xlsx`,
          sheetName: '資料匯出',
          transform: (e) => ({ ...e, date: DateUtils.parse(e.date) || '' }),
        });
      }

      function exportAllToExcel() {
        const prepareSheetData = (data, columnMapping, transformFn) => {
          if (!data || !data.length) return null;
          return data.map((row) => {
            const transformed = transformFn ? transformFn(row) : row;
            const mapped = {};
            for (const [srcKey, destKey] of Object.entries(columnMapping)) {
              let val = transformed[srcKey] || "";
              if (val instanceof Date) {
                val = (Date.UTC(val.getFullYear(), val.getMonth(), val.getDate()) - Date.UTC(1899, 11, 30)) / 864e5;
              }
              mapped[destKey] = val;
            }
            return mapped;
          });
        };

        const sheets = [];

        // ECN 清單
        const ecnSheet = prepareSheetData(
          ecnData,
          {
            id: "ECN 單號",
            ecrId: "ECR 單號",
            status: "表單狀態",
            applicant: "申請人",
            partNo: "變更品號",
            approver: "協辦人",
            priority: "需求等級",
            changeReason: "變更原因分類",
            scope: "變更範圍",
            applyTime: "申請日",
            approveTime1: "【一】簽核日",
            approveTime: "【二】簽核日",
            _totalDays: "全流程",
            _transferDate: "【二】收件日",
            plmStart: "PLM 啟動",
            plmRelease: "PLM 發佈",
            _plmWork: "PLM 作業",
            _plmSign: "PLM 簽核",
            _erpConfirm: "ERP 確認",
            _ecWorkDays: "EC內部天數",
            _complexity: "複雜度",
            _overdue: "逾期",
            overdueNote: "逾期說明",
          },
          (e) => {
            let t = isKPITarget(e.approver),
              a = e.isRejected || e.isRejected1,
              isVoid = StatusModule.isVoid(e.status),
              skip = a || isVoid;
            let d = skip ? "-" : DateUtils.calcWorkDays(e.applyTime, e.approveTime);
            let transferDt = skip ? "" : (e.arriveDate || "");
            let od = t && !skip && transferDt ? DateUtils.calcWorkDays(transferDt, e.approveTime) : null;
            let limit = OverdueModule.getThresholdPage1(e.priority, e.complexity);
            return {
              ...e,
              applyTime: DateUtils.parse(e.applyTime) || "",
              approveTime1: DateUtils.parse(e.approveTime1) || "",
              approveTime: DateUtils.parse(e.approveTime) || "",
              _transferDate: skip ? "" : DateUtils.parse((e.arriveDate || "")) || "",
              plmStart: DateUtils.parse(e.plmStart) || "",
              plmRelease: DateUtils.parse(e.plmRelease) || "",
              _totalDays: skip ? "-" : DateUtils.calcWorkDays(e.applyTime, e.approveTime),
              _plmWork: t && !skip ? DateUtils.calcWorkDays((e.arriveDate || ""), e.plmStart) : "",
              _plmSign: t && !skip ? DateUtils.calcWorkDays(e.plmStart, e.plmRelease) : "",
              _erpConfirm: t && !skip ? DateUtils.calcWorkDays(e.plmRelease, e.approveTime) : "",
              _ecWorkDays: t && !skip ? DateUtils.calcWorkDays((e.arriveDate || ""), e.approveTime) : "",
              _complexity: t ? (skip ? "" : e.complexity || "") : "",
              _overdue: t && !skip && e.complexity && typeof od === "number" && limit ? (od > limit ? od - limit : "未逾期") : "",
              overdueNote: e.overdueNote || "",
            };
          },
        );
        if (ecnSheet) sheets.push({ name: "ECN清單", data: ecnSheet });

        // PCB 清單
        const pcbSheet = prepareSheetData(
          pcbStore.list,
          {
            id: "PCB 單號",
            partNo: "PCB 料號",
            status: "表單狀態",
            applicant: "申請人",
            priority: "需求等級",
            name2: "【二】部門主管",
            time2: "【二】簽核",
            name3: "【三】工程中心",
            time3: "【三】簽核",
            updateDate1: "更新日期(二三)",
            kpi1: "(二↔三)",
            _overdue1: "逾期(二三)",
            note1: "說明(二三)",
            name7: "【七】Layout",
            time7: "【七】簽核",
            name8: "【八】工程中心",
            time8: "【八】簽核",
            updateDate2: "更新日期(七八)",
            kpi2: "(七↔八)",
            _overdue2: "逾期(七八)",
            note2: "說明(七八)",
            needApprove: "承認PCB",
            name13: "【十五】工程中心",
            time13: "【十五】簽核",
            name15: "【十八】工程中心",
            time15: "【十八】簽核",
            kpi3: "(十五↔十八)",
          },
          (e) => {
            return {
              ...e,
              time2: DateUtils.parse(e.time2) || "",
              time3: DateUtils.parse(e.time3) || "",
              updateDate1: DateUtils.parse(e.updateDate1) || "",
              _overdue1: OverdueModule.getOverdueDaysPage3(e.kpi1, e.isRejected3) ?? "",
              time7: DateUtils.parse(e.time7) || "",
              time8: DateUtils.parse(e.time8) || "",
              updateDate2: DateUtils.parse(e.updateDate2) || "",
              _overdue2: OverdueModule.getOverdueDaysPage3(e.kpi2, e.isRejected8) ?? "",
              time13: DateUtils.parse(e.time13) || "",
              time15: DateUtils.parse(e.time15) || "",
            };
          },
        );
        if (pcbSheet) sheets.push({ name: "PCB清單", data: pcbSheet });

        // ECN 轉單
        const ecnTransferSheet = prepareSheetData(
          (transferData || []).filter((e) => "ECN" === (e.type || "ECN")),
          {
            formId: "表單編號",
            dept: "申請部門",
            applicant: "申請人",
            step: "簽核步驟",
            arriveDate: "送達日期",
            result: "簽核結果",
            approveDate: "簽核日期",
            _workDays: "工作日",
            executor: "執行人",
            comment: "簽核意見",
          },
          (e) => ({
            ...e,
            arriveDate: DateUtils.parse(e.arriveDate) || "",
            approveDate: DateUtils.parse(e.approveDate) || "",
            _workDays: DateUtils.calcWorkDays(e.arriveDate, e.approveDate),
          }),
        );
        if (ecnTransferSheet) sheets.push({ name: "ECN轉單", data: ecnTransferSheet });

        // ECR 轉單
        const ecrTransferSheet = prepareSheetData(
          (transferData || []).filter((e) => "ECR" === e.type),
          {
            formId: "表單編號",
            dept: "申請部門",
            applicant: "申請人",
            step: "簽核步驟",
            arriveDate: "送達日期",
            result: "簽核結果",
            approveDate: "簽核日期",
            _workDays: "工作日",
            executor: "執行人",
            comment: "簽核意見",
          },
          (e) => ({
            ...e,
            arriveDate: DateUtils.parse(e.arriveDate) || "",
            approveDate: DateUtils.parse(e.approveDate) || "",
            _workDays: DateUtils.calcWorkDays(e.arriveDate, e.approveDate),
          }),
        );
        if (ecrTransferSheet) sheets.push({ name: "ECR轉單", data: ecrTransferSheet });

        // 新建板階
        const newBoardSheet = prepareSheetData(
          boardData.newBoard,
          {
            applyDate: "申請日期",
            updateDate: "更新日期",
            createDate: "建立日期",
            partNo: "板階料號",
            _stage: "階段",
            projectCode: "專案代碼",
            applicant: "申請人",
            hasBOM: "是否有BOM",
            bomDate: "BOM發佈日",
            creator: "建立人",
            priority: "需求等級",
            _workDays: "作業天數",
            _overdue: "逾期",
            overdueNote: "說明",
          },
          (e) => {
            const isCancelled = e.createDate === "取消";
            let t = isCancelled ? "" : DateUtils.calcWorkDays(e.updateDate || e.applyDate, e.createDate);
            const limit = OverdueModule.getThresholdPage5(e.priority);
            return {
              ...e,
              applyDate: DateUtils.parse(e.applyDate) || "",
              updateDate: DateUtils.parse(e.updateDate) || "",
              createDate: isCancelled ? "取消" : (DateUtils.parse(e.createDate) || ""),
              bomDate: DateUtils.parse(e.bomDate) || "",
              _stage: getStageFromPartNo(e.partNo),
              _workDays: isCancelled ? "-" : t,
              _overdue: !isCancelled && typeof t === "number" && limit ? (t > limit ? t - limit : "未逾期") : "",
              overdueNote: e.overdueNote || "",
            };
          },
        );
        if (newBoardSheet) sheets.push({ name: "新建板階", data: newBoardSheet });

        // 板階維護
        const boardMaintSheet = prepareSheetData(
          boardData.maintain,
          {
            date: "維護日期",
            maintainer: "維護人",
            partNo: "板階料號",
            note: "備註",
          },
          (e) => ({ ...e, date: DateUtils.parse(e.date) || "" }),
        );
        if (boardMaintSheet) sheets.push({ name: "板階維護", data: boardMaintSheet });

        // GPMS 啟動
        const gpmsSheet = prepareSheetData(
          pcbStore.gpms,
          {
            date: "日期",
            pcbNo: "PCB單號",
            partNo: "料號",
            maintainer: "執行人",
            note: "備註",
          },
          (e) => ({ ...e, date: DateUtils.parse(e.date) || "" }),
        );
        if (gpmsSheet) sheets.push({ name: "GPMS啟動", data: gpmsSheet });

        // PCB 維護
        const pcbMaintSheet = prepareSheetData(
          pcbStore.maintain,
          {
            date: "日期",
            partNo: "料號",
            maintainer: "執行人",
            type: "類別",
            category: "備註",
          },
          (e) => ({ ...e, date: DateUtils.parse(e.date) || "" }),
        );
        if (pcbMaintSheet) sheets.push({ name: "PCB維護", data: pcbMaintSheet });

        // 停用取替代
        const disableSheet = prepareSheetData(
          disableSubData,
          {
            date: "日期",
            ecnNo: "ECN 單號",
            tier: "階層",
            partNo: "料號",
            executor: "執行人",
            note: "備註",
          },
          (e) => ({ ...e, date: DateUtils.parse(e.date) || "" }),
        );
        if (disableSheet) sheets.push({ name: "停用取替代", data: disableSheet });

        // 協助項目
        const assistSheet = prepareSheetData(
          assistData,
          {
            date: "日期",
            category: "類別",
            content: "內容",
            person: "執行人",
            note: "備註"
          },
          (e) => ({ ...e, date: DateUtils.parse(e.date) || "" })
        );
        if (assistSheet) sheets.push({ name: "協助項目", data: assistSheet });

        // BOM 建立
        const bomSheet = prepareSheetData(
          bomData,
          {
            receiveDate: "收件日期",
            updateDate: "更新日期",
            applicant: "申請人",
            unit: "單位",
            partNo: "料號",
            _stage: "階段",
            priority: "需求等級",
            completeDate: "完成日期",
            executor: "執行人",
            _workDays: "作業天數",
            _overdue: "逾期",
            overdueNote: "說明",
          },
          (e) => {
            const isCancelled = e.completeDate === "取消";
            let t = isCancelled ? "" : DateUtils.calcWorkDays(e.updateDate || e.receiveDate, e.completeDate);
            const limit = OverdueModule.getThresholdPage17(e.priority);
            return {
              ...e,
              receiveDate: DateUtils.parse(e.receiveDate) || "",
              updateDate: DateUtils.parse(e.updateDate) || "",
              _stage: getStageFromPartNo(e.partNo),
              completeDate: isCancelled ? "取消" : (DateUtils.parse(e.completeDate) || ""),
              _workDays: isCancelled ? "-" : t,
              _overdue: !isCancelled && typeof t === "number" && limit ? (t > limit ? t - limit : "未逾期") : "",
              overdueNote: e.overdueNote || "",
            };
          },
        );
        if (bomSheet) sheets.push({ name: "BOM建立", data: bomSheet });

        // ECRECN 追蹤
        if (ecrEcnData && ecrEcnData.length) {
          const ecrEcnSheet = prepareSheetData(
            ecrEcnData,
            {
              ecrSerial:'ECR單號', ecrStatusText:'ECR狀態', ecrApplyTime:'ECR申請日',
              ecrApplicant:'ECR申請人', _ecrSign:'ECR簽核', ecrStep7Time:'ECR結案日', ecrDuration:'ECR天數',
              ecnSerial:'ECN單號', ecnStatusText:'ECN狀態', ecnApplyTime:'ECN申請日',
              ecnApplicant:'ECN申請人', _ecnSign:'ECN簽核', ecnStep2Time:'ECN二關日', ecnDuration:'ECN天數',
            },
            (e) => ({
              ...e,
              _ecrSign: (e.ecrSignInfo||'').replace(/\n+/g,'\n'),
              _ecnSign: (e.ecnSignInfo||'').replace(/\n+/g,'\n'),
              ecrDuration: e.ecrDuration !== '' ? parseFloat(e.ecrDuration) || '' : '',
              ecnDuration: e.ecnDuration !== '' ? parseFloat(e.ecnDuration) || '' : '',
            }),
          );
          if (ecrEcnSheet) sheets.push({ name: 'ECR_ECN追蹤', data: ecrEcnSheet });
        }
 
        // 資料匯出統計
        if (plmData && plmData.length) {
          const plmExportSheet = prepareSheetData(
            plmData,
            {
              date: '日期', category: '明細分類', executor: '執行人',
            },
            (e) => ({ ...e, date: DateUtils.parse(e.date) || '' }),
          );
          if (plmExportSheet) sheets.push({ name: '資料匯出', data: plmExportSheet });
        }

        if (sheets.length === 0) {
          ToastModule.show("無資料可匯出", "warning");
          return;
        }

        // 建立 inline Web Worker 來生成 Excel（完全不阻塞 UI）
        const workerCode = `
                  importScripts('https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js');
                  self.onmessage = function(e) {
                    try {
                      const sheets = e.data;
                      const book = XLSX.utils.book_new();
                      sheets.forEach(sheet => {
                        const ws = XLSX.utils.json_to_sheet(sheet.data);
                        for (let cell in ws) {
                          if (cell[0] !== '!' && ws[cell] && typeof ws[cell].v === 'number' && ws[cell].v > 40000 && ws[cell].v < 60000) {
                            ws[cell].t = 'n';
                            ws[cell].z = 'yyyy/mm/dd';
                          }
                        }
                        XLSX.utils.book_append_sheet(book, ws, sheet.name);
                      });
                      const wbout = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
                      self.postMessage({ success: true, data: wbout });
                    } catch (err) {
                      self.postMessage({ success: false, error: err.message });
                    }
                  };
                `;
        const workerBlob = new Blob([workerCode], { type: "application/javascript" });
        const workerBlobUrl = URL.createObjectURL(workerBlob);
        const worker = new Worker(workerBlobUrl);

        worker.onmessage = function (e) {
          worker.terminate();
          URL.revokeObjectURL(workerBlobUrl);
          if (e.data.success) {
            const xlsxBlob = new Blob([e.data.data], {
              type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            });
            const url = URL.createObjectURL(xlsxBlob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `EC統計資料_ALL_${DateUtils.today()}.xlsx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            ToastModule.show("匯出成功", "success");
          } else {
            console.error("Worker 匯出失敗:", e.data.error);
            ToastModule.show("匯出失敗: " + e.data.error, "error");
          }
        };

        worker.onerror = function (err) {
          worker.terminate();
          URL.revokeObjectURL(workerBlobUrl);
          console.error("Worker 錯誤:", err);
          ToastModule.show("匯出失敗", "error");
        };

        worker.postMessage(sheets);
      }

      // ==========================================
      // 15. 事件監聽與初始化 (Event Listeners & Init)
      // ==========================================

      /* 初始化 */
      document.addEventListener("DOMContentLoaded", async () => {
        loadFromCache();
        updateDatalists();
        updateAuthUI();
        syncHolidays();
        syncEcnFromAPI(false, true);
        moduleSyncState.ECN = true;
        lastToastTime.ECN = Date.now();   // 起算 toast 安靜期
        switchPage(2);
      });

      async function loadOverlayFromGist() {
        try {
          const { ID, PREFIX, FILES } = GIST_CONFIG.ECN;
          const r = await fetch(`${GITHUB_API_BASE}/gists/${ID}?t=${Date.now()}`, {
            headers: { Authorization: `token ${GITHUB_TOKEN}` },
          });
          if (!r.ok) {
            console.warn("[loadOverlayFromGist] HTTP " + r.status);
            return;
          }
          const gist = await r.json();
          const files = await handleTruncatedFiles(gist.files);
          // ECN overlay
          OverlayModule.loadEcnFromArray(YearlyModule.loadAndMerge(files, PREFIX.ECN, null));
          // settings / holidays
          if (files[FILES.SETTINGS]) {
            settingsData = JSON.parse(files[FILES.SETTINGS].content);
            localStorage.setItem("ec_settings", JSON.stringify(settingsData));
          }
          if (files[FILES.HOLIDAYS]) {
            const hData = JSON.parse(files[FILES.HOLIDAYS].content);
            if (hData.holidays) {
              holidayDates = hData.holidays;
              holidaySet = new Set(holidayDates);
            }
            if (hData.workdays) workdaySet = new Set(hData.workdays);
          }
        } catch (e) {
          console.error("[loadOverlayFromGist] 讀取失敗", e);
        }
      }

      /* 視窗事件 */
      window.addEventListener(
        "resize",
        Utils.debounce(() => {
          document.querySelectorAll("textarea").forEach((e) => Utils.autoResize(e));
        }, 200),
      );
      window.addEventListener("beforeunload", (e) => {
        const unsavedFab = document.getElementById("unsavedFab");
        const isFabVisible = unsavedFab && unsavedFab.style.display !== "none";

        if (isFabVisible || (typeof dirtySections !== "undefined" && dirtySections.size > 0)) {
          e.preventDefault();
          e.returnValue = "";
        }
      });
      window.addEventListener("unload", () => {
        if (cS) {
          cS.destroy();
          cS = null;
        }
        if (cD) {
          cD.destroy();
          cD = null;
        }
        if (_ecrAreaChart) { _ecrAreaChart.destroy(); _ecrAreaChart = null; }
        if (_ecnAreaChart) { _ecnAreaChart.destroy(); _ecnAreaChart = null; }
      });

      /* Chart.js 插件 */
      Chart.register({
        id: "centerText",
        beforeDraw(chart) {
          if (chart.config.type !== "doughnut") return;
          const ctx = chart.ctx;
          ctx.restore();
          const fontSize = (chart.height / 114).toFixed(2);
          ctx.font = `bold ${fontSize}em sans-serif`;
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#323130";
          const text = chart.config.options.plugins.centerText?.text || "";
          const textX = Math.round((chart.chartArea.left + chart.chartArea.right) / 2 - ctx.measureText(text).width / 2);
          const textY = (chart.chartArea.top + chart.chartArea.bottom) / 2;
          ctx.fillText(text, textX, textY);
          ctx.save();
        },
      });

      /* 定時檢查 */
      setInterval(checkSyncStale, 5000);

      // ==========================================
      // 16. Datalist 更新
      // ==========================================

      function updateDatalists() {
        let e = [...new Set(boardData.newBoard.map((e) => e.applicant).filter((e) => e))],
          t = [...new Set(boardData.newBoard.map((e) => e.creator).filter((e) => e))];
        ((document.getElementById("listApplicants").innerHTML = e.map((e) => `<option value="${e}">`).join("")), (document.getElementById("listCreators").innerHTML = t.map((e) => `<option value="${e}">`).join("")));
      }
