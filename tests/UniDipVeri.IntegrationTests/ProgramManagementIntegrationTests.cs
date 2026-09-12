using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using UniDipVeri.Application.Abstractions.Security;
using UniDipVeri.Application.Features.Auth.Models;
using UniDipVeri.Application.Features.Programs.Models;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;
using UniDipVeri.Infrastructure.Persistence;

namespace UniDipVeri.IntegrationTests;

[Collection("PostgreSqlIntegrationCollection")]
public class ProgramManagementIntegrationTests : IDisposable
{
    private readonly PostgreSqlTestFixture _fixture;
    private readonly HttpClient _client;
    private readonly IServiceScope _scope;
    private readonly UniDipVeriDbContext _dbContext;
    private readonly IPasswordHasher _passwordHasher;

    private readonly Guid _universityId = Guid.NewGuid();
    private readonly string _adminEmail;
    private readonly string _adminPassword = "SecureAdminPassword123!";
    private readonly string _registrarEmail;
    private readonly string _registrarPassword = "SecureRegistrarPassword123!";
    private readonly string _approverEmail;
    private readonly string _approverPassword = "SecureApproverPassword123!";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public ProgramManagementIntegrationTests(PostgreSqlTestFixture fixture)
    {
        _fixture = fixture;
        _client = fixture.Factory.CreateClient();
        _scope = fixture.Factory.Services.CreateScope();
        _dbContext = _scope.ServiceProvider.GetRequiredService<UniDipVeriDbContext>();
        _passwordHasher = _scope.ServiceProvider.GetRequiredService<IPasswordHasher>();

        var suffix = Guid.NewGuid().ToString("N")[..8];
        _adminEmail = $"admin_prog_{suffix}@miu.edu";
        _registrarEmail = $"reg_prog_{suffix}@miu.edu";
        _approverEmail = $"appr_prog_{suffix}@miu.edu";

        SeedTestData(suffix);
    }

    private void SeedTestData(string suffix)
    {
        var university = University.Create($"Uni {suffix}", $"U{suffix}".ToUpperInvariant(), $"{suffix}.miu.edu", id: _universityId);
        _dbContext.Universities.Add(university);

        var adminHash = _passwordHasher.HashPassword(_adminPassword);
        var adminStaff = UniversityStaff.Create(_universityId, "Program Admin", _adminEmail, adminHash, StaffRole.ADMIN);
        _dbContext.UniversityStaff.Add(adminStaff);

        var regHash = _passwordHasher.HashPassword(_registrarPassword);
        var regStaff = UniversityStaff.Create(_universityId, "Program Registrar", _registrarEmail, regHash, StaffRole.REGISTRAR);
        _dbContext.UniversityStaff.Add(regStaff);

        var apprHash = _passwordHasher.HashPassword(_approverPassword);
        var apprStaff = UniversityStaff.Create(_universityId, "Program Approver", _approverEmail, apprHash, StaffRole.APPROVER);
        _dbContext.UniversityStaff.Add(apprStaff);

        _dbContext.SaveChanges();
    }

    private async Task LoginAsAsync(string email, string password)
    {
        var response = await _client.PostAsJsonAsync("/api/staffs/login", new LoginRequest(email, password));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ProgramManagement_FullVerticalSlice_EndToEndFlow()
    {
        // 1. Unauthenticated request to /api/programs should return 401
        var unauthResponse = await _client.GetAsync("/api/programs");
        unauthResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // 2. Approver login should return 403 Forbidden on /api/programs
        await LoginAsAsync(_approverEmail, _approverPassword);
        var approverResponse = await _client.GetAsync("/api/programs");
        approverResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // 3. Registrar login allows CRUD operations
        await LoginAsAsync(_registrarEmail, _registrarPassword);

        var listResponse = await _client.GetAsync("/api/programs");
        listResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        // 4. Creation with keyword mismatch (FR-PROG-05) should return 400 Bad Request
        var mismatchPayload = new CreateProgramRequest
        {
            Name = "Data Science Mismatch",
            FullTitle = "Master of Science in Data Science", // Mismatches BACHELOR
            DegreeLevel = "BACHELOR"
        };
        var mismatchResponse = await _client.PostAsJsonAsync("/api/programs", mismatchPayload);
        mismatchResponse.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // 5. Creation with valid keyword matching degree level should return 201 Created
        var uniqueName = $"Data Science {Guid.NewGuid().ToString("N")[..6]}";
        var createPayload = new CreateProgramRequest
        {
            Name = uniqueName,
            FullTitle = "Bachelor of Science in Data Science",
            DegreeLevel = "BACHELOR"
        };
        var createResponse = await _client.PostAsJsonAsync("/api/programs", createPayload);
        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        createResponse.Headers.Location.Should().NotBeNull();

        var createdProgram = await createResponse.Content.ReadFromJsonAsync<ProgramResponse>(JsonOptions);
        createdProgram.Should().NotBeNull();
        createdProgram!.Name.Should().Be(uniqueName);
        createdProgram.FullTitle.Should().Be("Bachelor of Science in Data Science");
        createdProgram.DegreeLevel.Should().Be("BACHELOR");
        createdProgram.Status.Should().Be("ACTIVE");

        // 6. Duplicate program creation returns 409 Conflict
        var dupResponse = await _client.PostAsJsonAsync("/api/programs", createPayload);
        dupResponse.StatusCode.Should().Be(HttpStatusCode.Conflict);

        // 7. Get by ID returns the program
        var getResponse = await _client.GetAsync($"/api/programs/{createdProgram.Id}");
        getResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var fetchedProgram = await getResponse.Content.ReadFromJsonAsync<ProgramResponse>(JsonOptions);
        fetchedProgram!.Id.Should().Be(createdProgram.Id);

        // 8. Patch updates program details and status
        var patchPayload = new UpdateProgramRequest
        {
            FullTitle = "Master of Science in Advanced Data Science",
            DegreeLevel = "MASTER",
            Status = "INACTIVE"
        };
        var patchResponse = await _client.PatchAsJsonAsync($"/api/programs/{createdProgram.Id}", patchPayload);
        patchResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var updatedProgram = await patchResponse.Content.ReadFromJsonAsync<ProgramResponse>(JsonOptions);
        updatedProgram!.DegreeLevel.Should().Be("MASTER");
        updatedProgram.Status.Should().Be("INACTIVE");

        // 9. Admin login can also view and update programs
        await LoginAsAsync(_adminEmail, _adminPassword);
        var adminPatchPayload = new UpdateProgramRequest { Status = "ACTIVE" };
        var adminPatchResponse = await _client.PatchAsJsonAsync($"/api/programs/{createdProgram.Id}", adminPatchPayload);
        adminPatchResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var reactivated = await adminPatchResponse.Content.ReadFromJsonAsync<ProgramResponse>(JsonOptions);
        reactivated!.Status.Should().Be("ACTIVE");
    }

    public void Dispose()
    {
        _scope.Dispose();
        _client.Dispose();
        GC.SuppressFinalize(this);
    }
}
