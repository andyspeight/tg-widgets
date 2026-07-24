# Quote-PDF email — hardening plan (audit finding #8)

Owner: Andy Speight. Author: Claude Code. Written: 23 July 2026.

This is the short plan you asked for before I change how quote emails work.
Nothing here is built yet.

## The problem in plain terms

The "email me this quote" button sends a PDF to a customer. To do that, the
button hands our server three things from the web page: the quote content, the
recipient's email address, and the sender brand name. Our server trusts all
three.

That means someone technical, not using our widget at all, could call our email
endpoint directly with their own made-up quote, set the sender name to one of
your real clients, and the recipient to anyone they like. Our platform would
then send an attacker-written PDF, branded as your client, to that address. It
is only lightly throttled (twenty sends per network address).

So it is a brand-impersonation and spam risk that runs through our platform. It
is not a data leak, no stored client data is exposed, but it could embarrass a
client and damage trust if abused.

## Why I cannot just switch it off

That same "trust what the page sends" path is exactly how the legitimate button
works today. A quote page holds the quote as data, the customer clicks "email
me this", and the widget sends that data, including the customer's own address,
to our server. If I simply block page-supplied recipients, the real button
stops working.

There is a safer path already in the code, used when a quote has been saved:
the page carries only a short quote ID and key, and the server looks the quote
up itself. In that mode the recipient and brand come from the stored quote, not
the browser, so they cannot be faked. The fix is to make email always use that
safer path.

## The proposed fix

Make emailing require a server-registered quote.

1. When an agent creates or opens a quote, register it on our server (store the
   quote, its owning client, and the customer's address) and get back a short ID
   and key. Much of this plumbing already exists for the saved-quote path.
2. Change the email action so it only works with that ID and key. The server
   resolves the recipient and the brand from the stored quote, never from the
   browser. Downloading a PDF to your own screen can stay as it is, since that
   sends nothing to anyone else.
3. Tighten the send rate limit and keep a short audit trail of who emailed what
   to whom.

Result: the button works exactly as before for real agents and customers, but a
stranger can no longer make our platform send a client-branded PDF to an
arbitrary address, because they have no valid quote to email.

## Size and risk

Medium. It touches the quote create/open flow (to register the quote) and the
email action (to require the ID and key). The main risk is a transition period:
existing quote pages already embedded on client sites use the old page-data
path, so we either keep accepting page-data email for a short grace window while
pages update, or we roll the change out alongside a refreshed embed. That choice
is the main thing to decide.

## A quicker interim option, if you want cover sooner

If you want to reduce the risk this week without the full change, I can, as a
stopgap: cut the email rate limit hard, and stop the browser choosing the sender
brand, so a send always goes out under a neutral or platform name rather than a
client's. That kills the impersonation immediately. The cost is that legitimate
"email me this quote" messages would also lose the client's brand name until the
proper fix lands. Your call whether that trade is worth it in the meantime.

## What I need from you

1. Approval to do the proper fix (register quotes, email by ID and key).
2. A decision on the transition: grace window for old embedded pages, or roll
   out with a refreshed embed.
3. Whether you also want the quicker interim brand-lock now, accepting that real
   emails lose the client brand until the proper fix ships.
