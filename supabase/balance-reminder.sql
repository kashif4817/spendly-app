-- Balance reminders for shared books — run in the Supabase SQL editor AFTER
-- shared-books.sql and notifications.sql. Safe to re-run.
--
-- "Send a balance reminder" used to open the chat with a message drafted, and
-- the push went out when that message was sent. Now it is a notification and
-- nothing else: the app calls send_balance_reminder(), and the other member's
-- phone shows
--
--   💰 Kashif sent a balance reminder
--   You owe Kashif PKR 1,250 · Flat
--
-- and a tap opens the book. No chat message is written.
--
-- THE FIGURE COMES FROM THE SERVER, not the app: it is the sum over the rows
-- both phones sync, so the number in the notification is the number the other
-- member sees when they open the book.
--
-- It is the same 'reminder' event as before, so the "Balance reminders" switch
-- in Settings → Notifications and muting a book still silence it.
--
-- ONE PER HOUR per book and sender. It is a push to someone else's phone about
-- money; the cap is what stops it being used to nag.

-- 1) When each member last reminded, per book --------------------------------

create table if not exists public.shared_balance_reminders (
  book_id   text not null references public.shared_books (id) on delete cascade,
  sender_id uuid not null,
  sent_at   timestamptz not null default now(),
  primary key (book_id, sender_id)
);

-- Written only by the function below; nothing for a client to read either.
alter table public.shared_balance_reminders enable row level security;
revoke all on public.shared_balance_reminders from anon, authenticated;

-- 2) Send one ---------------------------------------------------------------------

/**
 * Remind the other member of a book about its balance. Returns the amount it
 * was about and which way it runs, from the caller's side:
 *   { "amount": 1250, "owed_to_me": true }
 *
 * Raises a bare code the app words: NOT_SIGNED_IN, BOOK_NOT_FOUND,
 * NOBODY_TO_REMIND, SETTLED, TOO_SOON.
 */
create or replace function public.send_balance_reminder(p_book_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me      uuid := auth.uid();
  v_balance double precision;
  v_last    timestamptz;
  v_sender  text;
  v_book    text;
  v_body    text;
begin
  if v_me is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  if not public.is_book_member(p_book_id) then
    raise exception 'BOOK_NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.shared_book_members m
     where m.book_id = p_book_id and m.user_id <> v_me and not m.deleted
  ) then
    raise exception 'NOBODY_TO_REMIND';
  end if;

  -- Positive when the caller is owed — the same sum the app's balance uses.
  select coalesce(sum(case when e.payer_id = v_me then e.amount else -e.amount end), 0)
    into v_balance
    from public.shared_entries e
   where e.book_id = p_book_id and not e.deleted;

  if abs(v_balance) < 0.005 then
    raise exception 'SETTLED';
  end if;

  select r.sent_at into v_last
    from public.shared_balance_reminders r
   where r.book_id = p_book_id and r.sender_id = v_me
   for update;
  if v_last is not null and v_last > now() - interval '1 hour' then
    raise exception 'TOO_SOON';
  end if;

  insert into public.shared_balance_reminders (book_id, sender_id, sent_at)
  values (p_book_id, v_me, now())
  on conflict (book_id, sender_id) do update set sent_at = excluded.sent_at;

  v_sender := public.notify_name(v_me);
  v_book   := public.notify_book_name(p_book_id);

  -- Read by the other member, so "you" is them.
  v_body := case when v_balance > 0
                 then 'You owe ' || v_sender || ' ' || public.notify_money(v_balance)
                 else v_sender || ' owes you ' || public.notify_money(v_balance)
            end || coalesce(' · ' || v_book, '');

  perform public.push_book_event(
    p_book_id, v_me, null, 'reminder', 'chat',
    '💰 ' || v_sender || ' sent a balance reminder',
    v_body,
    jsonb_build_object('type', 'book'));

  return jsonb_build_object('amount', abs(v_balance), 'owed_to_me', v_balance > 0);
end;
$$;

revoke all on function public.send_balance_reminder(text) from public, anon;
grant execute on function public.send_balance_reminder(text) to authenticated;

-- 3) Did it work? Expect one row: send_balance_reminder.
select proname from pg_proc where proname = 'send_balance_reminder';
