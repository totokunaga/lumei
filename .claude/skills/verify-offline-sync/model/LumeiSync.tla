---------------------------- MODULE LumeiSync ----------------------------
(***************************************************************************)
(* Lumei offline sync between devices and the Go API, with the category    *)
(* exception of BR-CAT-05. See docs/architecture/offline-sync.md and       *)
(* .claude/skills/verify-offline-sync/SKILL.md for what each part mirrors. *)
(*                                                                         *)
(* One indivisible step here is one indivisible step in the code:          *)
(*  - each user write is one SQLite write (frontend/src/db/records.ts);    *)
(*  - a push is applied in one Postgres transaction that holds the user's  *)
(*    change counter (SyncRepository.Apply, SyncUsecase.Push);             *)
(*  - the push's answer reaches the device later, or is lost (engine.ts    *)
(*    `push`);                                                             *)
(*  - a pull reads each table with its own SELECT, outside any             *)
(*    transaction (SyncRepository.Changes), so each table read is its own  *)
(*    step, categories before expenses as in `readers`;                    *)
(*  - the device applies a pulled page and its cursor in one SQLite        *)
(*    transaction (engine.ts `pull`, `applyPulled`).                       *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets, Sequences, TLC

CONSTANTS
    Devices,          \* the user's devices, model values such as {d1, d2}
    Cats,             \* category IDs; SeedCats is a subset
    Exps,             \* expense IDs
    SeedCats,         \* default categories every device has at start (BR-CAT-01)
    MaxClock,         \* bound: user changes are dated 2..MaxClock
    MaxSeq,           \* bound: the API's change counter stops at MaxSeq
    PullOneSnapshot   \* FALSE: as coded. TRUE: what-if, one snapshot per pull

Recs == Cats \cup Exps
NoCat == "none"

\* A row: whether it exists, its updated_at (ver), deleted_at set (del),
\* archived_at set (arch, categories), and category_id (cat, expenses).
Absent == [ex |-> FALSE, ver |-> 0, del |-> FALSE, arch |-> FALSE, cat |-> NoCat]
SeedRow == [ex |-> TRUE, ver |-> 1, del |-> FALSE, arch |-> FALSE, cat |-> NoCat]
NotRead == [got |-> FALSE, row |-> Absent, seq |-> 0]

VARIABLES
    srv,      \* API: [row: Recs -> row, seq: Recs -> change_seq, n: counter]
    dev,      \* dev[d][r]: the device's row
    pend,     \* pend[d][r]: the `pending` column
    rev,      \* rev[d][r]: the `local_rev` column
    cursor,   \* cursor[d]: sync_state.cursor on the device
    phase,    \* phase[d]: where the device's sync cycle is
    sent,     \* sent[d][r]: local_rev of r as pushed, 0 if not pushed
    buf,      \* buf[d][r]: pulled [got, row, seq] read so far
    now,      \* the last user change's date (one clock for all devices)
    made      \* ghost: made[e] is every version of expense e a user saved

vars == <<srv, dev, pend, rev, cursor, phase, sent, buf, now, made>>

Phases == {"idle", "push", "ack", "pullCats", "pullExps", "pullApply"}

TypeOK ==
    /\ phase \in [Devices -> Phases]
    /\ cursor \in [Devices -> Nat]
    /\ srv.n \in Nat
    /\ now \in Nat

Init ==
    /\ srv = [row |-> [r \in Recs |-> IF r \in SeedCats THEN SeedRow ELSE Absent],
              seq |-> [r \in Recs |-> IF r \in SeedCats THEN 1 ELSE 0],
              n |-> 1]  \* every seed row at change_seq 1, as one pulled page
    /\ dev = [d \in Devices |-> [r \in Recs |-> IF r \in SeedCats THEN SeedRow ELSE Absent]]
    /\ pend = [d \in Devices |-> [r \in Recs |-> FALSE]]
    /\ rev = [d \in Devices |-> [r \in Recs |-> 1]]
    /\ cursor = [d \in Devices |-> 1]
    /\ phase = [d \in Devices |-> "idle"]
    /\ sent = [d \in Devices |-> [r \in Recs |-> 0]]
    /\ buf = [d \in Devices |-> [r \in Recs |-> NotRead]]
    /\ now = 1
    /\ made = [e \in Exps |-> {}]

Live(row) == row.ex /\ ~row.del
LiveOn(d, r) == Live(dev[d][r])
ActiveOn(d, c) == LiveOn(d, c) /\ ~dev[d][c].arch
\* An ID from newId() is new everywhere.
Unused(r) == /\ ~srv.row[r].ex
             /\ \A d \in Devices : ~dev[d][r].ex

(***************************************************************************)
(* Conflict rules: application.Wins (sync.go) and `wins` (domain/sync.ts). *)
(***************************************************************************)
Wins(in, st) ==
    IF st.del THEN FALSE
    ELSE IF in.del THEN TRUE
    ELSE in.ver > st.ver

(***************************************************************************)
(* User writes (frontend/src/db/records.ts). Each sets updated_at, marks   *)
(* the row pending, and bumps local_rev (`created`, `changed`).            *)
(***************************************************************************)
Write(d, r, row, newRev) ==
    /\ now < MaxClock
    /\ now' = now + 1
    /\ dev' = [dev EXCEPT ![d][r] = [row EXCEPT !.ver = now + 1]]
    /\ made' = IF r \in Exps THEN [made EXCEPT ![r] = @ \cup {[row EXCEPT !.ver = now + 1]}]
                ELSE made
    /\ pend' = [pend EXCEPT ![d][r] = TRUE]
    /\ rev' = [rev EXCEPT ![d][r] = newRev]
    /\ UNCHANGED <<srv, cursor, phase, sent, buf>>

\* addCategory (BR-CAT-02)
AddCategory(d, c) ==
    /\ Unused(c)
    /\ Write(d, c, [SeedRow EXCEPT !.ver = 0], 1)

\* addExpense (BR-EXP-01): the category picker offers active categories
\* (readCategories, BR-CAT-03).
AddExpense(d, e, c) ==
    /\ Unused(e)
    /\ ActiveOn(d, c)
    /\ Write(d, e, [SeedRow EXCEPT !.cat = c], 1)

\* updateExpense (BR-EXP-06), here as a change of category, or of any other
\* field when c is its own category.
EditExpense(d, e, c) ==
    /\ LiveOn(d, e)
    /\ ActiveOn(d, c) \/ c = dev[d][e].cat
    /\ Write(d, e, [dev[d][e] EXCEPT !.cat = c], rev[d][e] + 1)

\* deleteExpense (BR-EXP-06)
DeleteExpense(d, e) ==
    /\ LiveOn(d, e)
    /\ Write(d, e, [dev[d][e] EXCEPT !.del = TRUE], rev[d][e] + 1)

OtherActive(d, c) == \E o \in Cats \ {c} : ActiveOn(d, o)

\* updateCategory or reorderCategories (BR-CAT-02): a rename, a new emoji, or
\* a new position. The model keeps no names, so only updated_at changes.
EditCategory(d, c) ==
    /\ LiveOn(d, c)
    /\ Write(d, c, dev[d][c], rev[d][c] + 1)

\* setCategoryArchived (BR-CAT-03): the last active category can't be archived.
ToggleArchived(d, c) ==
    /\ LiveOn(d, c)
    /\ dev[d][c].arch \/ OtherActive(d, c)
    /\ Write(d, c, [dev[d][c] EXCEPT !.arch = ~dev[d][c].arch], rev[d][c] + 1)

\* deleteCategory (BR-CAT-05): only a category none of the device's live
\* expenses use (countCategoryExpenses), and not the last active one.
DeleteCategory(d, c) ==
    /\ LiveOn(d, c)
    /\ \A e \in Exps : ~(LiveOn(d, e) /\ dev[d][e].cat = c)
    /\ dev[d][c].arch \/ OtherActive(d, c)
    /\ Write(d, c, [dev[d][c] EXCEPT !.del = TRUE], rev[d][c] + 1)

(***************************************************************************)
(* The API's push: SyncUsecase.Push, apply, keepUsedCategory,              *)
(* reviveCategory, SyncWriter.Save / CategoryInUse.                        *)
(***************************************************************************)
Save(S, r, row) ==
    [S EXCEPT !.row[r] = row, !.seq[r] = S.n + 1, !.n = S.n + 1]

InUse(S, c) == \E e \in Exps : Live(S.row[e]) /\ S.row[e].cat = c

KeepUsedCategory(S, r, row) ==
    IF r \in Cats /\ row.del /\ InUse(S, r)
    THEN [row EXCEPT !.del = FALSE, !.arch = TRUE]
    ELSE row

ReviveCategory(S, r, row) ==
    IF r \in Exps /\ ~row.del
       /\ S.row[row.cat].ex /\ S.row[row.cat].del
    THEN Save(S, row.cat, [S.row[row.cat] EXCEPT !.del = FALSE, !.arch = TRUE])
    ELSE S

ApplyRow(S, r, row) ==
    IF S.row[r].ex /\ ~Wins(row, S.row[r])
    THEN S                                    \* superseded
    ELSE LET S1 == Save(S, r, KeepUsedCategory(S, r, row))
         IN  ReviveCategory(S1, r, row)       \* applied

\* The rows sorted by the device's updated_at (readOutgoing).
RECURSIVE Sorted(_, _)
Sorted(d, R) ==
    IF R = {} THEN <<>>
    ELSE LET m == CHOOSE r \in R : \A q \in R : dev[d][r].ver <= dev[d][q].ver
         IN  <<m>> \o Sorted(d, R \ {m})

\* applyOrder: every other row first, in the order pushed, then the
\* category deletions.
ApplyOrder(d, R) ==
    LET dels == {r \in R : r \in Cats /\ dev[d][r].del}
    IN  Sorted(d, R \ dels) \o Sorted(d, dels)

RECURSIVE ApplyAll(_, _, _)
ApplyAll(S, d, order) ==
    IF order = <<>> THEN S
    ELSE ApplyAll(ApplyRow(S, Head(order), dev[d][Head(order)]), d, Tail(order))

(***************************************************************************)
(* The device's sync cycle (frontend/src/sync/engine.ts, scheduler.ts):    *)
(* one cycle at a time; push until nothing is pending, then pull.          *)
(***************************************************************************)
StartCycle(d) ==
    /\ phase[d] = "idle"
    /\ phase' = [phase EXCEPT ![d] = "push"]
    /\ UNCHANGED <<srv, dev, pend, rev, cursor, sent, buf, now, made>>

Outgoing(d) == {r \in Recs : pend[d][r]}

\* readOutgoing found nothing pending: go on to pull.
PushDone(d) ==
    /\ phase[d] = "push"
    /\ Outgoing(d) = {}
    /\ phase' = [phase EXCEPT ![d] = IF PullOneSnapshot THEN "pullExps" ELSE "pullCats"]
    /\ buf' = [buf EXCEPT ![d] = [r \in Recs |-> NotRead]]
    /\ UNCHANGED <<srv, dev, pend, rev, cursor, sent, now, made>>

\* pushChanges reaches the API, which applies it in one transaction.
PushApplied(d) ==
    /\ phase[d] = "push"
    /\ Outgoing(d) # {}
    /\ srv.n < MaxSeq
    /\ srv' = ApplyAll(srv, d, ApplyOrder(d, Outgoing(d)))
    /\ sent' = [sent EXCEPT ![d] = [r \in Recs |-> IF pend[d][r] THEN rev[d][r] ELSE 0]]
    /\ phase' = [phase EXCEPT ![d] = "ack"]
    /\ UNCHANGED <<dev, pend, rev, cursor, buf, now, made>>

\* The answer arrives: clear `pending` where local_rev hasn't changed.
\* (applied and superseded are handled alike; rejections aren't modelled.)
PushAnswered(d) ==
    /\ phase[d] = "ack"
    /\ pend' = [pend EXCEPT ![d] = [r \in Recs |->
                  IF sent[d][r] # 0 /\ sent[d][r] = rev[d][r] THEN FALSE ELSE pend[d][r]]]
    /\ phase' = [phase EXCEPT ![d] = "push"]
    /\ sent' = [sent EXCEPT ![d] = [r \in Recs |-> 0]]
    /\ UNCHANGED <<srv, dev, rev, cursor, buf, now, made>>

\* No network, or the answer was lost: the cycle ends, rows stay pending.
\* (sent and buf are cleared whenever they are no longer read, so states
\* that differ only in stale copies count as one.)
CycleFails(d) ==
    /\ phase[d] \in {"push", "ack", "pullCats", "pullExps", "pullApply"}
    /\ phase' = [phase EXCEPT ![d] = "idle"]
    /\ sent' = [sent EXCEPT ![d] = [r \in Recs |-> 0]]
    /\ buf' = [buf EXCEPT ![d] = [r \in Recs |-> NotRead]]
    /\ UNCHANGED <<srv, dev, pend, rev, cursor, now, made>>

Read(d, R) ==
    [r \in Recs |-> IF r \in R /\ srv.seq[r] > cursor[d]
                    THEN [got |-> TRUE, row |-> srv.row[r], seq |-> srv.seq[r]]
                    ELSE buf[d][r]]

\* SyncRepository.Changes: the categories SELECT (or, with
\* PullOneSnapshot, every table at once).
PullReadCategories(d) ==
    /\ phase[d] = "pullCats"
    /\ buf' = [buf EXCEPT ![d] = Read(d, Cats)]
    /\ phase' = [phase EXCEPT ![d] = "pullExps"]
    /\ UNCHANGED <<srv, dev, pend, rev, cursor, sent, now, made>>

\* SyncRepository.Changes: the expenses SELECT, a separate statement.
PullReadExpenses(d) ==
    /\ phase[d] = "pullExps"
    /\ buf' = [buf EXCEPT ![d] = Read(d, IF PullOneSnapshot THEN Recs ELSE Exps)]
    /\ phase' = [phase EXCEPT ![d] = "pullApply"]
    /\ UNCHANGED <<srv, dev, pend, rev, cursor, sent, now, made>>

\* applyPulled: a pending local row the pulled one doesn't beat is kept.
Keep(d, r) == dev[d][r].ex /\ pend[d][r] /\ ~Wins(buf[d][r].row, dev[d][r])
Got(d) == {r \in Recs : buf[d][r].got}

\* engine.ts `pull`: the page's rows and the new cursor in one transaction.
PullApplied(d) ==
    /\ phase[d] = "pullApply"
    /\ dev' = [dev EXCEPT ![d] = [r \in Recs |->
                 IF r \in Got(d) /\ ~Keep(d, r) THEN buf[d][r].row ELSE dev[d][r]]]
    /\ pend' = [pend EXCEPT ![d] = [r \in Recs |->
                 IF r \in Got(d) /\ ~Keep(d, r) THEN FALSE ELSE pend[d][r]]]
    /\ cursor' = [cursor EXCEPT ![d] =
                 IF Got(d) = {} THEN cursor[d]
                 ELSE CHOOSE s \in {buf[d][r].seq : r \in Got(d)} :
                        \A r \in Got(d) : buf[d][r].seq <= s]
    /\ phase' = [phase EXCEPT ![d] = "idle"]
    /\ buf' = [buf EXCEPT ![d] = [r \in Recs |-> NotRead]]
    /\ UNCHANGED <<srv, rev, sent, now, made>>

UserStep ==
    \E d \in Devices :
        \/ \E c \in Cats : AddCategory(d, c) \/ EditCategory(d, c) \/ ToggleArchived(d, c) \/ DeleteCategory(d, c)
        \/ \E e \in Exps : \E c \in Cats : AddExpense(d, e, c) \/ EditExpense(d, e, c)
        \/ \E e \in Exps : DeleteExpense(d, e)

SyncStep ==
    \E d \in Devices :
        \/ StartCycle(d) \/ PushDone(d) \/ PushApplied(d) \/ PushAnswered(d)
        \/ CycleFails(d) \/ PullReadCategories(d) \/ PullReadExpenses(d)
        \/ PullApplied(d)

Next == UserStep \/ SyncStep

Spec == Init /\ [][Next]_vars

StateBound == srv.n <= MaxSeq

\* The devices start alike, so swapping their names changes nothing.
DeviceSymmetry == Permutations(Devices)

(***************************************************************************)
(* Properties                                                              *)
(***************************************************************************)

\* BR-CAT-05, BR-CAT-03: the API never keeps a live expense whose category
\* is deleted or missing.
UsedCategoryKept ==
    \A e \in Exps : Live(srv.row[e]) =>
        /\ srv.row[e].cat \in Cats
        /\ Live(srv.row[srv.row[e].cat])

\* BR-OFF-03, BR-OFF-05: once every device is idle, has nothing pending, and
\* has pulled up to the API's counter, every device shows what the API has.
Quiet == \A d \in Devices :
    /\ phase[d] = "idle"
    /\ \A r \in Recs : ~pend[d][r]
    /\ cursor[d] = srv.n

Shown(row) ==
    IF ~row.ex THEN "absent"
    ELSE IF row.del THEN "deleted"
    ELSE <<row.ver, row.arch, row.cat>>

\* BR-OFF-03, BR-OFF-05: once all is quiet, the API holds the winning
\* change of every expense: a deletion if any device deleted it, otherwise
\* the change the user made last.
Expected(e) ==
    IF \E h \in made[e] : h.del
    THEN [Absent EXCEPT !.ex = TRUE, !.del = TRUE]
    ELSE CHOOSE h \in made[e] : \A o \in made[e] : o.ver <= h.ver

NoChangeLost ==
    Quiet => \A e \in Exps : made[e] # {} => Shown(srv.row[e]) = Shown(Expected(e))

Converged ==
    Quiet => \A d \in Devices : \A r \in Recs : Shown(dev[d][r]) = Shown(srv.row[r])

\* BR-OFF-03: a device never treats a record as synced that the API lacks.
SyncedRowsExist ==
    \A d \in Devices : \A r \in Recs :
        (dev[d][r].ex /\ ~pend[d][r]) => srv.row[r].ex

\* BR-OFF-05: a deleted expense stays deleted on the API.
ExpenseDeletionWins ==
    [][\A e \in Exps : srv.row[e].del => srv'.row[e].del]_vars

\* BR-OFF-05 rule 1 with its one exception (BR-CAT-05): a deleted category
\* comes back only for a live expense that has it.
CategoryDeletionUndoneOnlyForExpense ==
    [][\A c \in Cats :
         (srv.row[c].ex /\ srv.row[c].del /\ ~srv'.row[c].del) =>
             /\ srv'.row[c].arch
             /\ \E e \in Exps : Live(srv'.row[e]) /\ srv'.row[e].cat = c]_vars

\* BR-CAT-05: a pushed category deletion deletes the category unless a live
\* expense still has it once the push is applied (so an expense deleted or
\* moved in the same push doesn't keep it: `applyOrder`).
DeletionHonored ==
    [][\A d \in Devices :
         (phase[d] = "push" /\ phase'[d] = "ack") =>
             \A c \in Cats :
                 (pend[d][c] /\ dev[d][c].del /\ ~InUse(srv', c)) => srv'.row[c].del]_vars
=============================================================================
