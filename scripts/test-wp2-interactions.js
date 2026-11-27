const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../public/projects/physio-hemab-wp2/dashboard.js"), "utf8").replace(/\r\n/g,"\n");
const nodes = new Map();
const element = () => ({addEventListener(){}, querySelectorAll(){return []}, value:"", textContent:"", innerHTML:"", style:{setProperty(){}}, classList:{toggle(){},add(){},remove(){}}});
const doc = {getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)},addEventListener(){},querySelectorAll(){return []}};
const window = {addEventListener(){}};window.parent=window;
const cut = source.lastIndexOf('  document.querySelectorAll(".nav-item").forEach((button) => {');
assert.ok(cut > 0);
const context = {document:doc,window,console,Date};
vm.createContext(context);
vm.runInContext(source.slice(0,cut)+'\n globalThis.api={state,filteredParticipants,filteredDiaries,filteredReturns,filteredDistributions,filteredDeviceSets,kpiDetailData,kpiCard,componentRows,dataQualityIssues,setDimensionFilter,clearFilters};\n})();',context);
const a=context.api;
a.state.data={
 participants:[{studyId:"S1",facility:"F1",dataCollector:"A",enrollmentDate:"2026-11-26",enrollmentComplete:true},{studyId:"S2",facility:"F2",dataCollector:"B",enrollmentDate:"2026-11-25",enrollmentComplete:false}],
 activityDiaries:[{studyId:"S1",facility:"F1",dataCollector:"A",diaryDate:"2026-11-26",diaryComplete:true,sameDayInterview:"No",callsMade:2},{studyId:"S2",facility:"F2",dataCollector:"B",diaryDate:"2026-11-25",sameDayInterview:"Yes",callsMade:null}],
 deviceReturns:[{redcapRecordId:"R1",deviceSet:"A1",returnFacility:"F1",dataCollector:"A",returnDate:"2026-11-26",returnCompletenessStatus:"Incomplete",componentsReturned:4,componentsExpected:5},{redcapRecordId:"R2",deviceSet:"A2",returnFacility:"F1",dataCollector:"B",returnDate:"2026-11-25",returnCompletenessStatus:"Complete",componentsReturned:5,componentsExpected:5},{redcapRecordId:"R3",deviceSet:"A3",returnFacility:"F2",dataCollector:"B",returnDate:"2026-11-26",returnCompletenessStatus:"Unknown",componentsReturned:null,componentsExpected:5}],
 deviceDistributions:[{deviceSet:"A1",facility:"F1",dataCollector:"A",distributionDate:"2026-11-25"},{deviceSet:"A2",facility:"F1",dataCollector:"B",distributionDate:"2026-11-24"}],
 deviceSets:[{deviceSet:"A1",currentStatus:"Distributed",latestFacility:"F1",latestReturnFacility:"F2",latestDistributionCollector:"A",latestDistributionDate:"2026-11-26"},{deviceSet:"A2",currentStatus:"Returned",latestReturnFacility:"F1",latestReturnCollector:"B",latestReturnDate:"2026-11-25"}],config:{}
};
assert.equal(a.kpiDetailData("incompleteReturns").rows.length,1);
assert.equal(a.kpiDetailData("incompleteReturns").rows[0][0],"R1");
assert.equal(a.dataQualityIssues().find(r=>r.name==="Incomplete Device Returns").count,1);
assert.equal(a.componentRows().length,2);
assert.equal(a.kpiDetailData("calls").rows.length,1);
a.state.filters={facility:"F1",collector:"A",dateFrom:"2026-11-26",dateTo:"2026-11-26"};
assert.equal(a.filteredParticipants().length,1);
assert.equal(a.filteredDiaries().length,1);
assert.equal(a.filteredReturns().length,1);
assert.equal(a.filteredDistributions().length,0);
assert.equal(a.filteredDeviceSets().length,1);
assert.equal(a.kpiDetailData("incompleteReturns").rows.length,1);
assert.equal(a.kpiDetailData("completeReturns").rows.length,0);
assert.equal(a.kpiDetailData("enrollment").rows.length,1);
a.state.filters.collector="B";
assert.equal(a.kpiDetailData("incompleteReturns").rows.length,0);
a.state.filters={facility:"",collector:"B",dateFrom:"",dateTo:""};
assert.equal(a.filteredReturns().length,2);
assert.equal(a.filteredDistributions().length,1);
assert.equal(a.filteredDeviceSets().length,1);
assert.ok(a.kpiCard("Incomplete Returns","1").includes('data-kpi-details="incompleteReturns"'));
assert.ok(!a.kpiCard("Overall Study Target","200").includes("data-kpi-details"));
console.log("WP2 filter and record drill-down behavioral tests passed.");
