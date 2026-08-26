import { describeWorkflow, runWorkflowCases } from "../src/index.js";
import { cases } from "./nested-config-routing.cases.js";

describeWorkflow("nested-config-routing", () => runWorkflowCases(cases));
