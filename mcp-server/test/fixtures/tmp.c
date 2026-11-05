/* Worker Pool - C fixture for tree-sitter minifier testing */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <stddef.h>
#include <pthread.h>
#pragma once

// Pool configuration constants
#define MAX_WORKERS 16
#define QUEUE_CAPACITY 256
#define POOL_NAME "worker-pool" "-v1" /* 20. Adjacent string concatenation */
#define CLAMP(x, lo, hi) ((x) < (lo) ? (lo) : ((x) > (hi) ? (hi) : (x)))
#define OFFSET_OF(type, member) ((size_t)&((type *)0)->member)
#define LOG_TASK(fmt, ...) pool_log(__FILE__, __LINE__, fmt, ##__VA_ARGS__)

/* 19. Platform and debug defines (conditional compilation removed for minifier compat) */
#define PLATFORM_TAG "default"
#define DBG_PRINT(msg) ((void)0)
#define POOL_STACK_SIZE 8192

/* 9. Enum with explicit values */
typedef enum {
    TASK_IDLE = 0, TASK_PENDING = 1, TASK_RUNNING = 2,
    TASK_COMPLETE = 4, TASK_FAILED = 8, TASK_CANCELLED = 16
} task_state_t;

typedef void (*task_fn_t)(void *arg);  /* 8. Typedef for function pointers */
typedef int (*comparator_t)(const void *, const void *);

/* 3. Union */
typedef union {
    int as_int; float as_float; void *as_ptr; char as_bytes[8];
} task_result_t;

/* 4. Bitfields */
typedef struct {
    unsigned int priority : 4; unsigned int retryable : 1;
    unsigned int logged : 1; unsigned int reserved : 26;
} task_flags_t;

/* Linked list node */
typedef struct task_node {
    int id; task_fn_t execute; void *arg;
    task_state_t state; task_flags_t flags;
    task_result_t result; struct task_node *next;
} task_node_t;

/* 7. Volatile */
typedef struct {
    task_node_t *head; task_node_t *tail; int count;
    pthread_mutex_t lock; pthread_cond_t not_empty;
    volatile int shutdown;
} task_queue_t;

typedef struct {
    pthread_t threads[MAX_WORKERS]; int num_workers;
    task_queue_t queue; volatile int active_tasks;
} worker_pool_t;

static const char *state_names[] = { /* 12. Array initialization */
    [TASK_IDLE] = "idle", [TASK_PENDING] = "pending", [TASK_RUNNING] = "running",
    [TASK_COMPLETE] = "complete", [TASK_FAILED] = "failed", [TASK_CANCELLED] = "cancelled"
};

/* 10. Struct with designated initializers */
static task_flags_t default_flags = { .priority = 5, .retryable = 1, .logged = 0, .reserved = 0 };

/* 5. Variadic function (stdarg.h) + 6. Static function */
static void pool_log(const char *file, int line, const char *fmt, ...) {
    va_list args;
    char buf[512];
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    fprintf(stderr, "[%s:%d] %s\n", file, line, buf);
}

/* 13. Sizeof and offsetof */
static void print_layout(void) {
    printf("sizeof(task_node_t)  = %zu\n", sizeof(task_node_t));
    printf("sizeof(task_result_t)= %zu\n", sizeof(task_result_t));
    printf("offsetof(task_node_t, state) = %zu\n", offsetof(task_node_t, state));
    printf("OFFSET_OF(task_node_t, flags) = %zu\n", OFFSET_OF(task_node_t, flags));
}

static void queue_init(task_queue_t *q) {
    q->head = NULL;
    q->tail = NULL;
    q->count = 0;
    q->shutdown = 0;
    pthread_mutex_init(&q->lock, NULL);
    pthread_cond_init(&q->not_empty, NULL);
}

static void queue_push(task_queue_t *q, task_node_t *node) {
    pthread_mutex_lock(&q->lock);
    node->next = NULL;
    if (q->tail) {
        q->tail->next = node;
    } else {
        q->head = node;
    }
    q->tail = node;
    q->count++;
    pthread_cond_signal(&q->not_empty);
    pthread_mutex_unlock(&q->lock);
}

static task_node_t *queue_pop(task_queue_t *q) {
    pthread_mutex_lock(&q->lock);
    while (q->head == NULL && !q->shutdown) {
        pthread_cond_wait(&q->not_empty, &q->lock);
    }
    if (q->shutdown && q->head == NULL) {
        pthread_mutex_unlock(&q->lock);
        return NULL;
    }
    task_node_t *node = q->head;
    q->head = node->next;
    if (q->head == NULL) q->tail = NULL;
    q->count--;
    pthread_mutex_unlock(&q->lock);
    return node;
}

/* 11. Pointer arithmetic: walk the linked list via raw offset */
static int queue_count_walk(task_queue_t *q) {
    int n = 0;
    pthread_mutex_lock(&q->lock);
    for (task_node_t *p = q->head; p != NULL;
         p = *(task_node_t **)((char *)p + offsetof(task_node_t, next))) {
        n++;
    }
    pthread_mutex_unlock(&q->lock);
    return n;
}

/* Worker thread entry */
static void *worker_main(void *arg) {
    worker_pool_t *pool = (worker_pool_t *)arg;  /* 18. Cast expression */
    DBG_PRINT("worker started");

    /* 15. do-while loop */
    do {
        task_node_t *task = queue_pop(&pool->queue);
        if (task == NULL) break;

        task->state = TASK_RUNNING;
        __sync_fetch_and_add(&pool->active_tasks, 1);

        if (task->execute) {
            task->execute(task->arg);
            task->state = TASK_COMPLETE;
        } else {
            task->state = TASK_FAILED;
        }

        __sync_fetch_and_sub(&pool->active_tasks, 1);
        task->flags.logged = 1;
    } while (1);

    return NULL;
}

static int pool_create(worker_pool_t *pool, int num_workers) {
    /* 14. Ternary expression inside CLAMP macro */
    pool->num_workers = CLAMP(num_workers, 1, MAX_WORKERS);
    pool->active_tasks = 0;
    queue_init(&pool->queue);

    for (int i = 0; i < pool->num_workers; i++) {
        if (pthread_create(&pool->threads[i], NULL, worker_main, pool) != 0) {
            LOG_TASK("failed to create thread %d", i);
            return -1;
        }
    }
    return 0;
}

static void pool_destroy(worker_pool_t *pool) {
    pool->queue.shutdown = 1;
    pthread_cond_broadcast(&pool->queue.not_empty);
    for (int i = 0; i < pool->num_workers; i++) {
        pthread_join(pool->threads[i], NULL);
    }
    task_node_t *cur = pool->queue.head;
    while (cur) {
        task_node_t *tmp = cur;
        cur = cur->next;
        free(tmp);
    }
    pthread_mutex_destroy(&pool->queue.lock);
    pthread_cond_destroy(&pool->queue.not_empty);
}

/* Example task: compute via union storage */
static void compute_task(void *arg) {
    task_node_t *self = (task_node_t *)arg;
    self->result.as_int = self->id * self->id;
}

/* qsort comparator */
static int compare_task_ids(const void *a, const void *b) {
    const task_node_t *ta = *(const task_node_t **)a;
    const task_node_t *tb = *(const task_node_t **)b;
    return (ta->id > tb->id) - (ta->id < tb->id);
}

/* 16. Goto and labels - cleanup pattern */
static int write_results(const char *path, task_node_t **tasks, int n) {
    FILE *fp = NULL;
    char *buf = NULL;
    int ret = -1;

    fp = fopen(path, "w");
    if (!fp) goto cleanup;

    buf = (char *)malloc(1024);
    if (!buf) goto cleanup;

    for (int i = 0; i < n; i++) {
        int len = snprintf(buf, 1024, "task[%d] state=%d result=%d\n",
                           tasks[i]->id,
                           (int)tasks[i]->state,
                           tasks[i]->result.as_int);
        if (len < 0) goto cleanup;
        fwrite(buf, 1, (size_t)len, fp);
    }
    ret = 0;

cleanup:
    if (buf) free(buf);
    if (fp) fclose(fp);
    return ret;
}

/* 17. Comma operator */
static int make_id(void) {
    static int counter = 0;
    return (counter++, counter);
}

int main(int argc, char *argv[]) {
    /* 20. Adjacent string literal concatenation */
    printf("Starting " POOL_NAME " on " PLATFORM_TAG "\n");

    print_layout();

    /* 14. Ternary expressions */
    int nworkers = (argc > 1) ? atoi(argv[1]) : 4;
    int ntasks   = (argc > 2) ? atoi(argv[2]) : 20;

    worker_pool_t pool;
    if (pool_create(&pool, nworkers) != 0) {
        fprintf(stderr, "pool creation failed\n");
        return 1;
    }

    /* malloc + qsort later */
    task_node_t **task_ptrs = (task_node_t **)malloc(sizeof(task_node_t *) * (size_t)ntasks);
    if (!task_ptrs) return 1;

    for (int i = 0; i < ntasks; i++) {
        task_node_t *t = (task_node_t *)malloc(sizeof(task_node_t));
        memset(t, 0, sizeof(task_node_t));
        t->id = make_id();                /* 17. comma operator in make_id */
        t->execute = compute_task;
        t->arg = t;
        t->state = TASK_PENDING;
        t->flags = default_flags;         /* 10. designated-init struct */
        t->flags.priority = (unsigned int)(i % 16);
        task_ptrs[i] = t;
        queue_push(&pool.queue, t);
    }

    LOG_TASK("submitted %d tasks to %d workers", ntasks, pool.num_workers);

    /* Spin until queue drains */
    while (pool.queue.count > 0 || pool.active_tasks > 0) {
        /* busy wait */
    }

    pool_destroy(&pool);

    // Sort and write results to disk
    /* qsort completed tasks by id */
    qsort(task_ptrs, (size_t)ntasks, sizeof(task_node_t *), compare_task_ids);

    /* File I/O */
    write_results("/tmp/pool_results.txt", task_ptrs, ntasks);

    for (int i = 0; i < ntasks; i++) {
        printf("task %d -> %d (state: %s)\n",
               task_ptrs[i]->id,
               task_ptrs[i]->result.as_int,
               state_names[task_ptrs[i]->state]);
    }

    /* 11. Pointer arithmetic on array */
    task_node_t **end = task_ptrs + ntasks;
    for (task_node_t **p = task_ptrs; p < end; p++) {
        free(*p);
    }
    free(task_ptrs);

    return 0;
}
