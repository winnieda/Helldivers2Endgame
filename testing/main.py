def record_mission():
    """
    CLI prompts for each of the 7 slots and appends picks to missions.csv.
    """
    import csv
    from helper import load_prices
    SINGULAR = {
        'stratagems':'Stratagem',
        'primaries':'Primary',
        'secondaries':'Secondary',
        'grenades':'Grenade'
    }
    order = ['stratagems']*4 + ['primaries','secondaries','grenades']
    picks, expense = [], 0
    for cat in order:
        names, prices = load_prices(cat)
        print(f"Current expense: {expense}")
        print(f"Pick a {SINGULAR[cat]}:")
        for i,(n,p) in enumerate(zip(names,prices)):
            print(f"{i}: [{p}] {n}")
        choice = int(input("> "))
        expense += prices[choice]
        picks.append(choice)
    with open('missions.csv','a',newline='') as f:
        writer = csv.writer(f)
        writer.writerow(picks)
    print(f"Mission recorded: total expense {expense}")


def main():
    """
    Simple CLI: 1=do mission, 2=update prices, 3=exit.
    """
    import sys
    from helper import update_all_prices
    from simulate_runs import run_simulations
    while True:
        print("1: Do a mission")
        print("2: Update prices")
        print("3: 100 Simulations")
        print("4: Exit")
        cmd = input("> ")
        if cmd == '1':
            record_mission()
        elif cmd == '2':
            update_all_prices()
        elif cmd == '3':
            run_simulations()
        elif cmd == '4':
            sys.exit(0)
        else:
            print("Invalid choice, try again.")

if __name__ == '__main__':
    main()
