// The company's money (DESIGN §10e): a balance, a loan with interest, and a ledger. Pure,
// so the economy harness can run it; the game layer decides what costs what.
import { START_CASH, START_LOAN, LOAN_MAX, LOAN_RATE_PER_DAY, DAY_LENGTH } from './config.ts'

export type Entry = { t: number; what: string; amount: number }
const LEDGER_KEEP = 40

export class Bank {
  balance: number
  loan: number
  readonly ledger: Entry[] = []
  /** Interest accrued but not yet booked as a line: booked once it reaches a credit. */
  private interestDue = 0

  constructor(balance = START_CASH, loan = START_LOAN) { this.balance = balance; this.loan = loan }

  earn(t: number, what: string, amount: number): void {
    if (amount <= 0) return
    this.balance += amount
    this.book(t, what, amount)
  }

  /** Pay if you can. False, and nothing paid, if you cannot. `book` false pays without a ledger line, for a running charge that is booked once when it ends (see `note`). */
  spend(t: number, what: string, amount: number, book = true): boolean {
    if (amount <= 0) return true
    if (amount > this.balance) return false
    this.balance -= amount
    if (book) this.book(t, what, -amount)
    return true
  }

  /** Take it whether or not you have it: the balance can go below zero. For an excess you owe. */
  charge(t: number, what: string, amount: number): void {
    if (amount <= 0) return
    this.balance -= amount
    this.book(t, what, -amount)
  }

  /** A ledger line on its own, for a charge already taken with spend(…, false). */
  note(t: number, what: string, amount: number): void { if (amount !== 0) this.book(t, what, amount) }

  /** Interest on the loan for `dt` game seconds, continuous; a ledger line per whole credit. */
  accrue(dt: number, t: number): void {
    if (this.loan <= 0) return
    const due = this.loan * LOAN_RATE_PER_DAY * (dt / DAY_LENGTH)
    this.balance -= due
    this.interestDue += due
    if (this.interestDue >= 1) { this.book(t, 'INTEREST', -this.interestDue); this.interestDue = 0 }
  }

  /** Borrow up to LOAN_MAX; returns what was actually borrowed. */
  borrow(t: number, amount: number): number {
    const take = Math.max(0, Math.min(amount, LOAN_MAX - this.loan))
    if (take > 0) { this.loan += take; this.balance += take; this.book(t, 'LOAN', take) }
    return take
  }

  /** Repay what you can of `amount`; returns what was actually repaid. */
  repay(t: number, amount: number): number {
    const pay = Math.max(0, Math.min(amount, this.loan, this.balance))
    if (pay > 0) { this.loan -= pay; this.balance -= pay; this.book(t, 'REPAY', -pay) }
    return pay
  }

  private book(t: number, what: string, amount: number): void {
    this.ledger.push({ t, what, amount })
    if (this.ledger.length > LEDGER_KEEP) this.ledger.splice(0, this.ledger.length - LEDGER_KEEP)
  }

  toJSON(): { balance: number; loan: number; ledger: Entry[] } { return { balance: this.balance, loan: this.loan, ledger: this.ledger.slice() } }
  static fromJSON(j: { balance: number; loan: number; ledger?: Entry[] } | null | undefined): Bank {
    const b = new Bank(j?.balance ?? START_CASH, j?.loan ?? START_LOAN)
    if (j?.ledger) for (const e of j.ledger.slice(-LEDGER_KEEP)) b.ledger.push(e)
    return b
  }
}
