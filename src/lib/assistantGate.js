import React from "react";
import { reportAllows, targetOf } from "./access.js";
import { assistant } from "./assistantClient.js";
import { requirementOf } from "./operations.js";

// assistantGate.js — what this person may ask of one assistant, as that assistant says.
//
// Every assistant — a node's leaf or the cluster's anchor — publishes its operations and answers
// `/me/access` for its own actions, so a surface asks the assistant it is talking to about the request
// it would make, and names no assistant action itself. Shared by the panel's dock and the standalone
// page, so it reaches nothing of the panel's data layer.
//
// `useAssistantGate(targetId)` reads both once per assistant and returns `mayCall(method, path, body)`:
// true when every entry the request matches is held, false while either answer is missing or the
// request is one the assistant does not publish.
function useAssistantGate(targetId) {
  const [answers, setAnswers] = React.useState(null);

  React.useEffect(() => {
    setAnswers(null);
    if (!targetId) return undefined;
    let live = true;
    const client = assistant.host(targetId);
    Promise.all([client.operations(), client.access()]).then(
      ([operations, report]) => { if (live) setAnswers({ operations, report }); },
      () => {},
    );
    return () => { live = false; };
  }, [targetId]);

  return React.useMemo(() => ({
    ready: !!answers,
    mayCall(method, path, body) {
      if (!answers) return false;
      const req = requirementOf(answers.operations, method, path, body);
      return req.published && req.entries.every((e) => reportAllows(answers.report, e.action, targetOf({ cluster: true })));
    },
  }), [answers]);
}

export { useAssistantGate };
