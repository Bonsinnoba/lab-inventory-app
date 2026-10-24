// Keep the legacy collection alias during coordinated desktop upgrades. The
// database's observations column remains prose; never mutate that source row.
export function experimentObservationProjection(experiment, records) {
  return {...experiment, observations_text:experiment.observations,
    observations:records, observation_records:records};
}

export function assertExperimentObservationText(record) {
  if(record.observations_text_available===false ||
    (Object.hasOwn(record,'observations') && typeof record.observations!=='string')) {
    const error=new Error('Experiment observation text is unavailable or uses a legacy collection payload. Preserve this change and review it after synchronizing the experiment.');
    error.status=409;error.code='EXPERIMENT_OBSERVATIONS_UNAVAILABLE';throw error;
  }
}
