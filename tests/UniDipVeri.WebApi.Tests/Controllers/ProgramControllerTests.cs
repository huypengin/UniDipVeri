using System.Reflection;
using System.Security.Claims;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using UniDipVeri.Application.Features.Programs.Abstractions;
using UniDipVeri.Application.Features.Programs.Models;
using UniDipVeri.Domain.Enums;
using UniDipVeri.WebApi.Controllers;

namespace UniDipVeri.WebApi.Tests.Controllers;

public class ProgramControllerTests
{
    private readonly Mock<IProgramService> _programServiceMock = new();
    private readonly ProgramController _controller;

    public ProgramControllerTests()
    {
        _controller = new ProgramController(_programServiceMock.Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext()
            }
        };
    }

    private void SetAuthenticatedUser(params StaffRole[] roles)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new("user_type", "staff")
        };
        foreach (var role in roles)
        {
            claims.Add(new Claim(ClaimTypes.Role, role.ToString()));
        }

        var identity = new ClaimsIdentity(claims, "TestAuth");
        _controller.ControllerContext.HttpContext.User = new ClaimsPrincipal(identity);
    }

    private void SetUnauthenticatedUser()
    {
        _controller.ControllerContext.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity());
    }

    #region Authorization Attribute Tests

    [Fact]
    public void ProgramController_ShouldBeDecoratedWithAuthorizeAttribute_RequiringRegistrarRole()
    {
        var authAttr = typeof(ProgramController).GetCustomAttribute<AuthorizeAttribute>();
        authAttr.Should().NotBeNull();
        authAttr!.Roles.Should().Be("REGISTRAR");
    }

    #endregion

    #region CreateProgram Tests

    [Fact]
    public async Task CreateProgram_ShouldReturnBadRequest_WhenRequestBodyIsNull()
    {
        SetAuthenticatedUser(StaffRole.REGISTRAR);

        var result = await _controller.CreateProgram(null);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task CreateProgram_ShouldReturnBadRequest_WhenServiceReturnsValidation()
    {
        SetAuthenticatedUser(StaffRole.REGISTRAR);
        var request = new CreateProgramRequest { Name = "CS", FullTitle = "Wrong Title", DegreeLevel = "BACHELOR" };

        _programServiceMock.Setup(s => s.CreateProgramAsync(request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(ProgramResult<ProgramResponse>.Validation("Keyword mismatch"));

        var result = await _controller.CreateProgram(request);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task CreateProgram_ShouldReturnConflict_WhenServiceReturnsConflict()
    {
        SetAuthenticatedUser(StaffRole.REGISTRAR);
        var request = new CreateProgramRequest { Name = "CS", FullTitle = "Bachelor of CS", DegreeLevel = "BACHELOR" };

        _programServiceMock.Setup(s => s.CreateProgramAsync(request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(ProgramResult<ProgramResponse>.Conflict("Program already exists"));

        var result = await _controller.CreateProgram(request);

        result.Should().BeOfType<ConflictObjectResult>();
    }

    [Fact]
    public async Task CreateProgram_ShouldReturnCreatedAtAction_WhenServiceReturnsSuccess()
    {
        SetAuthenticatedUser(StaffRole.REGISTRAR);
        var request = new CreateProgramRequest { Name = "CS", FullTitle = "Bachelor of CS", DegreeLevel = "BACHELOR" };
        var id = Guid.NewGuid();
        var response = new ProgramResponse { Id = id, Name = "CS", FullTitle = "Bachelor of CS", DegreeLevel = "BACHELOR" };

        _programServiceMock.Setup(s => s.CreateProgramAsync(request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(ProgramResult<ProgramResponse>.Success(response));

        var result = await _controller.CreateProgram(request);

        var createdResult = result.Should().BeOfType<CreatedAtActionResult>().Subject;
        createdResult.StatusCode.Should().Be(StatusCodes.Status201Created);
        createdResult.Value.Should().Be(response);
        createdResult.RouteValues!["id"].Should().Be(id);
    }

    #endregion

    #region ListPrograms Tests

    [Fact]
    public async Task ListPrograms_ShouldReturnOkWithPrograms_WhenRegistrarRole()
    {
        SetAuthenticatedUser(StaffRole.REGISTRAR);
        var list = new List<ProgramResponse>
        {
            new() { Id = Guid.NewGuid(), Name = "CS" },
            new() { Id = Guid.NewGuid(), Name = "SE" }
        };

        _programServiceMock.Setup(s => s.ListProgramsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(ProgramResult<IReadOnlyList<ProgramResponse>>.Success(list));

        var result = await _controller.ListPrograms();

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.Value.Should().BeEquivalentTo(list);
    }

    #endregion

    #region GetProgramById Tests

    [Fact]
    public async Task GetProgramById_ShouldReturnNotFound_WhenProgramDoesNotExist()
    {
        SetAuthenticatedUser(StaffRole.REGISTRAR);
        var id = Guid.NewGuid();

        _programServiceMock.Setup(s => s.GetProgramByIdAsync(id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(ProgramResult<ProgramResponse>.NotFound("Program not found."));

        var result = await _controller.GetProgramById(id);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task GetProgramById_ShouldReturnOk_WhenProgramExists()
    {
        SetAuthenticatedUser(StaffRole.REGISTRAR);
        var id = Guid.NewGuid();
        var response = new ProgramResponse { Id = id, Name = "CS" };

        _programServiceMock.Setup(s => s.GetProgramByIdAsync(id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(ProgramResult<ProgramResponse>.Success(response));

        var result = await _controller.GetProgramById(id);

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.Value.Should().Be(response);
    }

    #endregion

    #region UpdateProgram Tests

    [Fact]
    public async Task UpdateProgram_ShouldReturnBadRequest_WhenRequestBodyIsNull()
    {
        SetAuthenticatedUser(StaffRole.REGISTRAR);

        var result = await _controller.UpdateProgram(Guid.NewGuid(), null);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task UpdateProgram_ShouldReturnNotFound_WhenProgramDoesNotExist()
    {
        SetAuthenticatedUser(StaffRole.REGISTRAR);
        var id = Guid.NewGuid();
        var request = new UpdateProgramRequest { Name = "CS Updated" };

        _programServiceMock.Setup(s => s.UpdateProgramAsync(id, request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(ProgramResult<ProgramResponse>.NotFound("Program not found."));

        var result = await _controller.UpdateProgram(id, request);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task UpdateProgram_ShouldReturnBadRequest_WhenServiceReturnsValidation()
    {
        SetAuthenticatedUser(StaffRole.REGISTRAR);
        var id = Guid.NewGuid();
        var request = new UpdateProgramRequest { FullTitle = "Wrong Title" };

        _programServiceMock.Setup(s => s.UpdateProgramAsync(id, request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(ProgramResult<ProgramResponse>.Validation("Keyword mismatch"));

        var result = await _controller.UpdateProgram(id, request);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task UpdateProgram_ShouldReturnConflict_WhenServiceReturnsConflict()
    {
        SetAuthenticatedUser(StaffRole.REGISTRAR);
        var id = Guid.NewGuid();
        var request = new UpdateProgramRequest { Name = "Existing Name" };

        _programServiceMock.Setup(s => s.UpdateProgramAsync(id, request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(ProgramResult<ProgramResponse>.Conflict("Name conflict"));

        var result = await _controller.UpdateProgram(id, request);

        result.Should().BeOfType<ConflictObjectResult>();
    }

    [Fact]
    public async Task UpdateProgram_ShouldReturnOk_WhenServiceReturnsSuccess()
    {
        SetAuthenticatedUser(StaffRole.REGISTRAR);
        var id = Guid.NewGuid();
        var request = new UpdateProgramRequest { Name = "New CS" };
        var response = new ProgramResponse { Id = id, Name = "New CS" };

        _programServiceMock.Setup(s => s.UpdateProgramAsync(id, request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(ProgramResult<ProgramResponse>.Success(response));

        var result = await _controller.UpdateProgram(id, request);

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.Value.Should().Be(response);
    }

    #endregion
}
