/**
 * THE HELP MODAL, RENDERED.
 *
 * `helpContent.test.js` proves the corpus is well-formed. This proves the modal
 * actually reaches it — which is the half that was broken in a way data alone
 * cannot show: the guides `AdminAIPromptsDoc` and `HostQuickStartDoc` existed
 * and were correct, and the buttons meant to open them passed ids the switch
 * did not have, so they opened "This documentation section is currently under
 * development" instead.
 *
 * jsdom has no layout engine, so there is not one geometric assertion here.
 * Everything below is roles, accessible names, and document text.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import HelpSystem from '../components/HelpSystem';
import { HELP_ROLES, GUIDE_BY_ID } from '../config/help';
import { TEMPLATE_VARIABLES } from '../config/templateVariables';

const allGuides = HELP_ROLES.flatMap((r) => r.guides);

/** The sentence the old default branch rendered for 16 of 18 guides. */
const PLACEHOLDER = /under development|being loaded|coming soon/i;

describe('§1 home', () => {
  test('lists every role, and every guide title under it', () => {
    render(<HelpSystem onClose={() => {}} />);
    HELP_ROLES.forEach((role) => {
      const card = screen.getByRole('button', { name: new RegExp(role.title, 'i') });
      role.guides.forEach((guide) => {
        expect(within(card).getByText(guide.title)).toBeInTheDocument();
      });
    });
  });

  test('the role cards are buttons, so a keyboard can reach them', () => {
    // They were `<div onClick>` with `cursor: pointer` — unreachable by
    // keyboard and unannounced by a screen reader, in the help modal.
    render(<HelpSystem onClose={() => {}} />);
    HELP_ROLES.forEach((role) => {
      expect(screen.getByRole('button', { name: new RegExp(role.title, 'i') })).toBeInTheDocument();
    });
  });
});

describe('§2 every guide opens onto real content', () => {
  /*
    THE CENTRAL REGRESSION. On the shipped code, 16 of these 18 would have hit
    the placeholder branch — and the only way to find that out was to click all
    eighteen tiles by hand.
  */
  test.each(allGuides.map((g) => [g.id, g.title]))(
    '%s renders its own heading and no apology',
    (id, title) => {
      render(<HelpSystem section={id} onClose={() => {}} />);
      expect(screen.getByRole('heading', { level: 1, name: new RegExp(title, 'i') }))
        .toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(PLACEHOLDER);
    }
  );

  test('a guide shows the role it belongs to, as a way back', () => {
    render(<HelpSystem section="host-player-management" onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'For hosts' })).toBeInTheDocument();
  });
});

describe('§3 the section ids AdminPage actually passes', () => {
  /*
    Both of these were dead on arrival. `documentation['ai-prompts']` was
    undefined and the switch had no `case 'ai-prompts'`, so the most contextual
    help button in the product opened the placeholder.
  */
  test('section="ai-prompts" opens the prompts guide', () => {
    render(<HelpSystem section="ai-prompts" onClose={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: /Prompts/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(PLACEHOLDER);
  });

  test('section="websocket-settings" opens the settings guide', () => {
    render(<HelpSystem section="websocket-settings" onClose={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: /Settings/i })).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/Real-time communication/i);
  });

  test('section="admin" opens the admin role index', () => {
    render(<HelpSystem section="admin" onClose={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: /For admins/i })).toBeInTheDocument();
  });

  test('an unknown section lands on home rather than an apology', () => {
    render(<HelpSystem section="not-a-thing" onClose={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: /Help/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(PLACEHOLDER);
  });
});

describe('§4 navigation', () => {
  test('a role card opens that role, and a guide tile opens the guide', () => {
    render(<HelpSystem onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /For players/i }));
    expect(screen.getByRole('heading', { level: 1, name: /For players/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Joining a session/i }));
    expect(screen.getByRole('heading', { level: 1, name: /Joining a session/i }))
      .toBeInTheDocument();
  });

  test('Back returns to where you came from', () => {
    render(<HelpSystem onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /For players/i }));
    fireEvent.click(screen.getByRole('button', { name: /Joining a session/i }));
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));
    expect(screen.getByRole('heading', { level: 1, name: /For players/i })).toBeInTheDocument();
  });

  test('Back from home is disabled rather than a no-op that looks broken', () => {
    render(<HelpSystem onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /Back/i })).toBeDisabled();
  });
});

describe('§5 the search field, which used to discard what you typed', () => {
  const type = (value) =>
    fireEvent.change(screen.getByRole('searchbox', { name: /Search documentation/i }), {
      target: { value },
    });

  test('it has an accessible name, not just a placeholder', () => {
    render(<HelpSystem onClose={() => {}} />);
    expect(screen.getByRole('searchbox', { name: /Search documentation/i })).toBeInTheDocument();
  });

  test('typing narrows to matching guides', () => {
    render(<HelpSystem onClose={() => {}} />);
    type('handover');
    expect(screen.getByRole('button', { name: /Managing players/i })).toBeInTheDocument();
    // A guide that says nothing about handovers is gone from the page.
    expect(screen.queryByRole('button', { name: /What you need to run it/i })).toBeNull();
  });

  test('a result opens the guide it names', () => {
    render(<HelpSystem onClose={() => {}} />);
    type('handover');
    fireEvent.click(screen.getByRole('button', { name: /Managing players/i }));
    expect(screen.getByRole('heading', { level: 1, name: /Managing players/i }))
      .toBeInTheDocument();
  });

  test('a query that matches nothing says so', () => {
    render(<HelpSystem onClose={() => {}} />);
    type('zzzzzznothing');
    expect(screen.getByRole('heading', { name: /Nothing matches/i })).toBeInTheDocument();
  });
});

describe('§6 the footer', () => {
  test('Report an issue points at the real repository', () => {
    render(<HelpSystem onClose={() => {}} />);
    const link = screen.getByRole('link', { name: /Report an issue/i });
    expect(link).toHaveAttribute('href', 'https://github.com/geseib/engagements/issues');
    expect(link.getAttribute('href')).not.toContain('your-repo');
  });

  test('the troubleshooting shortcut opens a written guide, not a placeholder', () => {
    render(<HelpSystem onClose={() => {}} />);
    // Exact, not a regex: the Technical role card's accessible name concatenates
    // its guide titles, so /Troubleshooting/ matches the card as well.
    fireEvent.click(screen.getByRole('button', { name: 'Troubleshooting' }));
    expect(screen.getByRole('heading', { level: 1, name: /Troubleshooting/i }))
      .toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(PLACEHOLDER);
  });

  test('close is reachable by its accessible name', () => {
    const onClose = jest.fn();
    render(<HelpSystem onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Close help/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('§7 derived blocks render from the real tables', () => {
  test('the game-type table lists the playable types and their real phases', () => {
    render(<HelpSystem section="host-quick-start" onClose={() => {}} />);
    const text = document.body.textContent;
    expect(text).toContain('Call & Answer');
    expect(text).toContain('Wavelength');
    // Survey is not playable, so it must not be offered as an option.
    expect(text).not.toContain('Survey');
  });

  /*
    The drift the old guide shipped with: it told hosts trivia's VOTE phase was
    "automatic — no voting needed". Trivia has no VOTE phase.
  */
  test('trivia is shown as ASK → RESULTS with no vote step', () => {
    render(<HelpSystem section="host-quick-start" onClose={() => {}} />);
    expect(document.body.textContent).toMatch(/Trivia has no voting step/i);
  });

  /*
    THE DESCRIPTION, NOT JUST THE NAME. A first version of this test asserted
    only that `{question}` appeared, and a mutation that replaced the catalogue
    lookup with `{ name, description: name }` — printing every placeholder with
    itself as its explanation — sailed through it. The name is the half the
    guide supplies; the description is the half that must come from
    `templateVariables.js`, so the description is what has to be asserted.
  */
  test('placeholder descriptions come from the catalogue, not the guide', () => {
    render(<HelpSystem section="admin-ai-prompts" onClose={() => {}} />);
    const reveal = TEMPLATE_VARIABLES.find((v) => v.name === 'reveal');
    const question = TEMPLATE_VARIABLES.find((v) => v.name === 'question');

    expect(screen.getByText('{reveal}')).toBeInTheDocument();
    expect(screen.getByText(reveal.description)).toBeInTheDocument();
    expect(screen.getByText('{question}')).toBeInTheDocument();
    expect(screen.getByText(question.description)).toBeInTheDocument();
  });
});

describe('§8 no guide is unreachable from the modal', () => {
  test('every guide id in the corpus can be opened by section', () => {
    Object.keys(GUIDE_BY_ID).forEach((id) => {
      const { unmount } = render(<HelpSystem section={id} onClose={() => {}} />);
      expect(document.body.textContent).not.toMatch(PLACEHOLDER);
      unmount();
    });
  });
});
