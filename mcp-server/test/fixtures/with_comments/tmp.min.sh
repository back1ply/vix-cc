#!/usr/bin/env bash
# Worker-pool management script
set -euo pipefail
readonly VERSION="1.2.0" MAX_WORKERS=8
readonly LOG_FILE="/var/log/worker-pool.log" PID_DIR="/var/run/workers"
declare -A worker_status=( [idle]=0 [busy]=0 [error]=0 )
declare -A worker_pids
declare -a task_queue=() completed_tasks=()
trap 'cleanup; exit 130' INT TERM
trap 'on_exit $?' EXIT
cleanup() {
    local pid
    for pid in "${worker_pids[@]:-}"; do
        kill "$pid" 2>/dev/null || true
    done
    rm -rf "${PID_DIR:?}/"* > /dev/null 2>&1
}
on_exit() {
    local exit_code=$1
    (( exit_code != 0 )) && log "ERROR" "Exited with code ${exit_code}"
}
log() {
    local level=$1 msg=$2
    local ts; ts=$(date +%Y-%m-%dT%H:%M:%S)
    printf '[%s] %-5s %s\n' "$ts" "$level" "$msg" >> "$LOG_FILE"
}
usage() {
    printf 'Usage: %s [OPTIONS]\n' "$(basename "$0")"
    printf 'Worker-pool manager v%s\n' "${VERSION}"
    printf 'Options:\n'
    printf '  -w NUM   Number of workers (default: %s)\n' "${MAX_WORKERS}"
    printf '  -t FILE  Task file to process\n'
    printf '  -v       Verbose output\n'
    printf '  -h       Show this help\n'
}
parse_config() {
    local config_file=$1
    local defaults
    defaults="workers=4
timeout=30
retry=3"
    while IFS='=' read -r key value; do
        [[ -z "$key" || "$key" == \#* ]] && continue
        case "$key" in
            workers) MAX_WORKERS_OVERRIDE="${value}" ;;
            timeout) TIMEOUT="${value}" ;;
            retry)   RETRY_COUNT="${value}" ;;
            *)       log "WARN" "Unknown config key: ${key}" ;;
        esac
    done < <(echo "$defaults"; cat "$config_file" 2>/dev/null)
}
expand_task() {
    local task=$1 name="${1:-unnamed}"
    local prefix="${name%%_*}" suffix="${name##*.}"
    local length=${#name} cleaned="${name//-/_}"
    printf "Task: %s (prefix=%s, suffix=%s, len=%d, clean=%s)\n" 
        "$name" "$prefix" "$suffix" "$length" "$cleaned"
}
run_worker() {
    local id=$1 task=$2 result
    if [[ ! -f "$task" ]]; then
        log "ERROR" "Task file not found: $task"; return 1
    fi
    [[ -d "$PID_DIR" && -x "$PID_DIR" ]] && echo $$ > "${PID_DIR}/worker_${id}.pid"
    result=$(process_task "$task" 2>&1) || {
        worker_status[error]=$(( ${worker_status[error]} + 1 )); return 1
    }
    worker_status[busy]=$(( ${worker_status[busy]} - 1 ))
    worker_status[idle]=$(( ${worker_status[idle]} + 1 ))
    echo "$result"
}
process_task() {
    local file=$1 line_count
    line_count=$(wc -l < "$file" | tr -d ' ')
    if (( line_count == 0 )); then echo "empty"; return 0; fi
    local checksum
    checksum=`md5sum "$file" | cut -d' ' -f1`
    echo "${checksum}"
}
dispatch_tasks() {
    local num_workers=$1; shift
    local tasks=("$@") i=0
    for task in "${tasks[@]}"; do
        if (( i >= num_workers )); then wait -n; (( i-- )); fi
        run_worker "$i" "$task" &
        worker_pids["w${i}"]=$!
        (( i++ ))
    done
    wait
}
monitor_workers() {
    local timeout=${1:-30} elapsed=0
    while (( elapsed < timeout )); do
        local active=0
        for pid in "${worker_pids[@]:-}"; do
            kill -0 "$pid" 2>/dev/null && (( active++ ))
        done
        [[ $active -eq 0 ]] && break
        diff <(echo "${worker_status[busy]}") <(echo "0") > /dev/null && break
        sleep 1; (( elapsed++ ))
    done
    until (( elapsed >= timeout )); do (( elapsed++ )); break; done
}
collect_results() {
    local output_file=$1
    {
        echo "--- Worker Pool Results ---"
        printf "Idle: %d | Busy: %d | Errors: %d\n" 
            "${worker_status[idle]}" "${worker_status[busy]}" "${worker_status[error]}"
        for t in "${completed_tasks[@]:-}"; do echo "  Completed: $t"; done
    } > "$output_file" 2>&1
    sort "$output_file" | uniq -c | sort -rn >> "${output_file}.summary" 2>/dev/null || true
    cat "$output_file" | tee -a "$LOG_FILE" > /dev/null
}
main() {
    local num_workers=$MAX_WORKERS task_file="" verbose=0
    while getopts ":w:t:vh" opt; do
        case $opt in
            w) num_workers=$OPTARG ;;
            t) task_file=$OPTARG ;;
            v) verbose=1 ;;
            h) usage; return 0 ;;
            \?) echo "Invalid option: -${OPTARG}" >&2; return 1 ;;
            :)  echo "Option -${OPTARG} requires an argument" >&2; return 1 ;;
        esac
    done
    shift $((OPTIND - 1))
    [[ -n "${task_file}" ]] || { usage; return 1; }
    if [[ -r "$task_file" ]]; then
        while IFS= read -r line; do
            [[ -n "$line" ]] && task_queue+=("$line")
        done < "$task_file"
    fi
    (( ${#task_queue[@]} > 0 )) || { echo "No tasks found" >&2; return 1; }
    parse_config "/etc/worker-pool.conf"
    local total=${#task_queue[@]}
    log "INFO" "Starting pool: ${num_workers} workers, ${total} tasks"
    mkdir -p "$PID_DIR" &>/dev/null || true
    for i in "${!task_queue[@]}"; do expand_task "${task_queue[$i]}"; done
    dispatch_tasks "$num_workers" "${task_queue[@]}"
    monitor_workers 60
    collect_results "/tmp/worker-pool-results.txt"
    (( verbose )) && echo "All ${total} tasks processed."
}
main "$@"
