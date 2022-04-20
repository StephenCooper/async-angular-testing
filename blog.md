# Angular fakeAsync

If you are working with an Angular application and writing tests at some point you are going to need to handle tests with asynchronous behaviour. In this article we will show with a code example how to think about testing asynchronous code.

## Test Context

For the purpose of this article we will be testing an application that uses AG Grid. In the application there is a quick filter which is used to filter the rows in the grid based on the input from a text box. You can try the application out for yourself [here](https://plnkr.co/edit/ef2ozOyGVZlvT2wq?open=app%2Fapp.component.ts).

We are going to test that for the set of Olympic medal winners that we can filter to a specific country of interest.  Our test should validate that:

1. The grid initially shows the full set of data and our application displays the correct row count.
1. Upon entering the text "Germany" into the filter box the grid should filter the rows to German athletes and the displayed row count should match.

The reason for choosing this application, as an example for this article, is that it contains asynchronous code making it virtually impossible to test synchronously. 

### Application Code

The main parts of the component code are as follows. I have omitted some general properties for simplicity. It boils down to having a text input box that is bound to the `quickFilterText` string property on our component. We also show the current number of displayed rows in our template. The `quickFilterText` is bound to our grid component to enable it to filter our grid data.

The current number of rows will be kept up to date by using the grid callback `(modelUpdated)` which is fired every time the grid model is updated, including when filtering is performed.

```html
      <input
        type="text"
        id="quickFilter"
        [(ngModel)]="quickFilterText"
      />
      <div id="numberOfRows">Number of rows: {{ displayedRows }}</div>

    <ag-grid-angular #grid
      [quickFilterText]="quickFilterText"
      (modelUpdated)="onModelUpdated($event)"
    ></ag-grid-angular>
```

When the model changes we get the latest displayed row count from the grid to update our template value.

```ts
export class AppComponent implements OnInit {
  public displayedRows: number = 0;
  public quickFilterText: string = '';

  @ViewChild('grid') grid: AgGridAngular;

  onModelUpdated(params: ModelUpdatedEvent) {
    this.displayedRows = params.api.getDisplayedRowCount();
  }
}

```


### Test helpers

Before we get to the tests let me quickly explain the assertion helper function we will be using in our tests. 
This helper function is going to help us gain insight into the inner workings of our test, especially when we start working with asynchronous behaviour. 

The function validates the following at the same point in time:

- internal grid state
- state of the component variable `displayedRows`
- rendered HTML output of the `{{ displayedRows }}` binding

We will see that these values do not update at the same instance due to asynchronous callbacks and when change detection is executed.

```ts
function validateState({ gridRows, displayedRows, templateRows }) {
  
    // Validate the internal grid model by calling its api method to get the row count
    expect(component.grid.api.getDisplayedRowCount()).toEqual(gridRows)
    
    // Validate the component property displayedRows
    expect(component.displayedRows).toEqual(displayedRows)

    // Validate the rendered html content that the user would see 
    expect(rowNumberDE.nativeElement.innerHTML).toContain(templateRows)
}
```

### Configuring the Test Module

 The first part of the test is to configure the test module. It requires AG Grid's `AgGridModule` and also Angular's `FormModule` to provided support for `ngModel`.
 
 > Note that we do not run fixture.detectChanges() inside the beforeEach method! This can lead to numerous issues when testing asynchronous code!

 ```ts
beforeEach(() => {
    TestBed.configureTestingModule({
        declarations: [AppComponent],
        imports: [AgGridModule, FormsModule],
    });
    // Create the test component fixture
    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    let compDebugElement = fixture.debugElement;

    // Get a reference to the quickFilter input and rendered template
    quickFilterDE = compDebugElement.query(By.css('#quickFilter'))
    rowNumberDE = compDebugElement.query(By.css('#numberOfRows'))
});
 ```

## Broken Synchronous Test

As a starting point lets show what happens if we try to write the test in a synchronous manner. i.e writing it the simplest way possible.

```ts
it('should filter rows by quickfilter (sync version)', (() => {

    // When the test starts our test component has been created but not our grid.
    expect(component.grid).toBeUndefined()
    // Our first call to detectChanges, causes the grid to be create
    fixture.detectChanges()
    // Grid has now been created
    expect(component.grid.api).toBeDefined()

    // Run change detection to update template
    fixture.detectChanges()

    validateState({ gridRows: 1000, displayedRows: 1000, templateRows: 1000 })
  }))
```

While it looks like this test should pass it does not. We get the following errors.

```bash
Error: component.displayedRows: Expected 0 to equal 1000.
Error: <div> {{displayedRows}} </div>: Expected 'Number of rows: 0 for' to contain 1000.
```

What we can see from this is that the grid setup code is synchronous which is why the internal grid state does have 1,000 rows at the time of our assertion. However, the component property is still showing a value of 0. This is because the grid callback is executed asynchronously and so is still in the Javascript event queue when we reach the assertion statement.

For more details you may want to read these fantastic articles:
 - [JavaScript Visualized: Event Loop](https://dev.to/lydiahallie/javascript-visualized-event-loop-3dif)
 - [Tasks, microtasks, queues and schedules](https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/)


So while it is possible to validate the internal grid state we are not able to validate our own application code. We are going to need to update out tests to correctly handle asynchronous callbacks. 

## Writing an Async Test

We are going to cover two approaches for writing tests for asynchronous grid behaviour:

 - Using `fakeAsync`
 - Using `async` `await`


## FakeAsync

As asynchronous code is very common Angular provides us with the [fakeAsync](https://angular.io/api/core/testing/fakeAsync) test utility for testing this kind of code. It enables us to control the flow of time and when asynchronous tasks are executed with the methods `tick()` and `flush()`.

The high level concept with `fakeAsync` is that when the test code comes across async functions they are added into a time based queue instead of actually being executed. As a developer we can choose when these tasks are executed. If we want to run all the currently queued async functions we call `flush()`. As the name suggests, this flushes all the queued up tasks out of the queue, executing them in order as they are removed from the queue. 

If we have code that uses `setTimeout(() => {}, 500)` with a time value, then this will get added to the fake async queue with a time delay of 500. We can use the tick function to advance time a given amount. This will walk through the queue and execute and tasks that are scheduled before this time. So it gives us more control over how many tasks are removed from the queue as compared to flush.

It is worth noting that there is also a `flushMicrotasks()` function. For an example of when you might use this instead of `flush` take a look at this [article](https://www.damirscorner.com/blog/posts/20210702-AngularTestingFlushVsFlushMicrotasks.html).

### Controlling Change Detection in our test

You will see the following line of code `fixture.detectChanges()` in a lot of Angular tests. This enables you to control when change detection is run. As part of change detection Input bindings receive their updated values and html templates are re-rendered with the updated component values. Each of these are important when you want to validate that code is working correctly.  In the test code below, we will highlight why we are required to call `fixture.detectChanges()` to progress our component state. 

### Quick Filter Test with FakeAsync

What follows is the full test code written using `fakeAsync` to validate that our application correctly filters the data in our grid and updates our template with the correct number of displayed rows. I have annotated every line of code, as there are a lot of moving parts that can be quite hard to grasp from just reading the code.

#### Test setup

The first thing to do is wrap our test body in `fakeAsync`. This causes all async functions to be patched so that we can control their execution.

```ts
import { fakeAsync, flush } from '@angular/core/testing';

it('should filter rows by quickFilterText', fakeAsync(() => {
    ...
}
```

When the test starts our application component has been created but it has not been initialised. i.e ngOnInit has not run. This means that our `<ag-grid-angular>` component has not been created or had data passed to it. To validate this, we can test that the grid is undefined at the start of the test.

The first call to `fixture.detectChanges()`, creates the grid and binds the component values to the grid via its @Inputs. When working with `fakeAsync` ensure the first call to `fixture.detectChanges()` is within the test body and **NOT** in a `beforeEach` section. This is vital as it means that during the construction of the grid all async behaviour is correctly patched. It is also good practice to keep each test fully isolated from each other.

```ts
// At the start of the test the grid is undefined
expect(component.grid).toBeUndefined()

// Initialise our component which constructs the grid
fixture.detectChanges()

// Validate that the grid has now been created.
expect(component.grid.api).toBeDefined()
```

Now we can validate that the internal grid model is correct. It should have 1000 rows. However, at this point the asynchronous grid callbacks have not run. i.e the (modelUpdated) @Output has not fired.
This is why the internal grid state has 1000 rows, but the component and template still have 0 values.
```ts
// Validate the synchronous grid setup code has completed but not any async updates
validateState({ gridRows: 1000, displayedRows: 0, templateRows: 0 })
```

#### Run async tasks from setup 

To have the asynchronous functions, that are currently sitting in the execution queue, run we call `flush()`. This runs all the async calls that were triggered during the initialisation of the grid and any added created during the flush itself) until it is empty. It is likely that your async code creates new asynchronous tasks. Be default `flush()` will attempt to draining the queue of these newly added calls up to a default limit of 20 turns. If for some reason your async tasks trigger other async tasks more than 20 times you can increase this limit by passing it to flush. i.e `flush(100)`.

Now the component has its displayedRows property updated as (modelUpdated) executes. However, this is not reflected in the template as change detection has not run. For the rendered template to reflect the updated component property we need to trigger change detection. This causes the template to be re-rendered with the latest values in from the component.

State is now with consistent between the internal grid model, component data and renderer template. All correctly show 1000 rows before any filtering.

```ts
// Flush all async tasks from the queue
flush();
// Validate that our component property has now been updated by the onModelUpdated callback
validateState({ gridRows: 1000, displayedRows: 1000, templateRows: 0 })
// Force the template to be updated
fixture.detectChanges()
// Component state is stable and consistent
validateState({ gridRows: 1000, displayedRows: 1000, templateRows: 1000 })
```

#### Update Filter Text

Now its time to enter our test text into the filter input. We set the filter value to 'Germany' and fire the input event which is required for `ngModel` to react to the filter change.

At this point the text input has been updated but the grid Input [quickFilterText]="quickFilterText" has not been updated as that requires change detection.
```ts
quickFilterDE.nativeElement.value = 'Germany'
quickFilterDE.nativeElement.dispatchEvent(new Event('input'));

// Input [quickFilterText]="quickFilterText" has not been updated yet so grid is not filtered
validateState({ gridRows: 1000, displayedRows: 1000, templateRows: 1000 })
```

Trigger change detection to apply the update to the Input binding [quickFilterText]="quickFilterText".

The grid has now used the quickFilterText property to filters its rows.
Validate that the internal number of rows has been reduced to 68 for all German rows.
However, once again, the displayedRows has not been updated yet
as the grid schedules callbacks asynchronously.
```ts
// Run change detection to push new filter value into the grid component
fixture.detectChanges()

validateState({ gridRows: 68, displayedRows: 1000, templateRows: 1000 })
```
The component event handler, (modelUpdated), has now run and updated its displayedRows value.

Run change detection again so that the template reflects the displayedRows value from the component.
State is now stable and the quick filter has been validated    
```ts
//flush all the asynchronous callbacks.
flush()

validateState({ gridRows: 68, displayedRows: 68, templateRows: 1000 })

fixture.detectChanges()
validateState({ gridRows: 68, displayedRows: 68, templateRows: 68 })
```

## Full Test Code

Here is a more concise version of the test without all the intermediary validation steps. Hopefully it is now clear why we have this repeating pattern of `detectChanges` -> `flush` -> `detectChanges`. In both cases you can think of it as: update component inputs values, run async tasks of AG Grid and finally, update the template with the resulting values. 

```ts
it('should filter rows by quickFilterText using fakeAsync', fakeAsync(() => {
    
    // Setup grid, run async tasks, update HTML template
    fixture.detectChanges()
    flush();
    fixture.detectChanges()

    // Validate full set of data is displayed
    validateState({ gridRows: 1000, displayedRows: 1000, templateRows: 1000 })

    // Update the filter text input
    quickFilterDE.nativeElement.value = 'Germany'
    quickFilterDE.nativeElement.dispatchEvent(new Event('input'));

    // Push filter text to grid, run async tasks, update HTML template
    fixture.detectChanges()
    flush()
    fixture.detectChanges()

    // Validate correct number of rows are shown for our filter text
    validateState({ gridRows: 68, displayedRows: 68, templateRows: 68 })

  }))
```

### Using Auto Detect Changes

Now that we understand the data flow in the test above we can actually shorten this test further by taking advantage of the [fixture.autoDetectChanges()](https://angular.io/guide/testing-utility-apis#componentfixture-methods) method. 

> Set this to true when you want the fixture to detect changes automatically.
When autodetect is true, the test fixture calls detectChanges immediately after creating the component. Then it listens for pertinent zone events and calls detectChanges accordingly.
The default is false. Testers who prefer fine control over test behavior tend to keep it false.

```ts
it('should filter rows by quickFilterText using fakeAsync auto', fakeAsync(() => {

    // Setup grid, run async tasks, auto update HTML template
    fixture.autoDetectChanges()
    flush();

    // Validate full set of data is displayed
    validateState({ gridRows: 1000, displayedRows: 1000, templateRows: 1000 })

    // Update the filter text input, auto update grid binding
    quickFilterDE.nativeElement.value = 'Germany'
    quickFilterDE.nativeElement.dispatchEvent(new Event('input'));

    // Run async tasks, auto update HTML template
    flush()

    // Validate correct number of rows are shown for our filter text
    validateState({ gridRows: 68, displayedRows: 68, templateRows: 68 })
  }))
```